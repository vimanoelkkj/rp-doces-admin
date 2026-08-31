import { json, sameOrigin } from "../../../lib/http.js";
import { requireUser } from "../../../lib/auth.js";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"]
]);
const SLOTS = new Map([
  ["hero", "home_hero_image_key"],
  ["about", "home_about_image_key"]
]);

function resolveSlot(value) {
  const slot = String(value || "").toLowerCase();
  const configKey = SLOTS.get(slot);
  return configKey ? { slot, configKey } : null;
}

function imageKey(slot, extension) {
  return `site-${slot}-${crypto.randomUUID()}.${extension}`;
}

async function currentKey(env, configKey) {
  const row = await env.DB.prepare("SELECT valor FROM configuracoes_loja WHERE chave = ?")
    .bind(configKey)
    .first();
  return String(row?.valor || "");
}

async function saveKey(env, configKey, key) {
  await env.DB.prepare(
    `INSERT INTO configuracoes_loja (chave, valor, atualizado_em)
     VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(chave) DO UPDATE SET valor=excluded.valor, atualizado_em=CURRENT_TIMESTAMP`
  )
    .bind(configKey, key)
    .run();
}

export async function onRequestPost({ request, env, params }) {
  if (!sameOrigin(request)) return json({ erro: "Origem inválida." }, 403);
  const auth = await requireUser(env, request);
  if (auth.error) return auth.error;
  if (!env.PRODUCT_IMAGES) return json({ erro: "Storage de imagens não configurado." }, 503);

  const resolved = resolveSlot(params.slot);
  if (!resolved) return json({ erro: "Imagem da página inicial inválida." }, 400);

  const form = await request.formData().catch(() => null);
  const file = form?.get("image");
  if (!(file instanceof File)) return json({ erro: "Envie uma imagem válida." }, 400);
  if (!ALLOWED_TYPES.has(file.type)) return json({ erro: "Use JPG, PNG ou WebP." }, 415);
  if (file.size < 1 || file.size > MAX_IMAGE_BYTES)
    return json({ erro: "A imagem deve ter no máximo 5 MB." }, 413);

  const previousKey = await currentKey(env, resolved.configKey);
  const extension = ALLOWED_TYPES.get(file.type);
  const key = imageKey(resolved.slot, extension);

  await env.PRODUCT_IMAGES.put(key, await file.arrayBuffer(), {
    httpMetadata: {
      contentType: file.type,
      cacheControl: "public, max-age=31536000, immutable"
    },
    customMetadata: {
      slot: resolved.slot,
      uploadedBy: String(auth.user?.id || "")
    }
  });

  try {
    await saveKey(env, resolved.configKey, key);
  } catch (error) {
    await env.PRODUCT_IMAGES.delete(key).catch(() => {});
    throw error;
  }

  if (previousKey && previousKey !== key) {
    await env.PRODUCT_IMAGES.delete(previousKey).catch(() => {});
  }

  return json({ ok: true, image_key: key, image_url: `/api/images/${encodeURIComponent(key)}` });
}

export async function onRequestDelete({ request, env, params }) {
  if (!sameOrigin(request)) return json({ erro: "Origem inválida." }, 403);
  const auth = await requireUser(env, request);
  if (auth.error) return auth.error;
  if (!env.PRODUCT_IMAGES) return json({ erro: "Storage de imagens não configurado." }, 503);

  const resolved = resolveSlot(params.slot);
  if (!resolved) return json({ erro: "Imagem da página inicial inválida." }, 400);

  const previousKey = await currentKey(env, resolved.configKey);
  await saveKey(env, resolved.configKey, "");
  if (previousKey) await env.PRODUCT_IMAGES.delete(previousKey).catch(() => {});

  return json({ ok: true });
}
