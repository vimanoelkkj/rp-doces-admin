import { json, sameOrigin } from "../../../../lib/http.js";
import { requireUser } from "../../../../lib/auth.js";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"]
]);

function validId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function canManageAvatar(viewer, targetId) {
  return viewer?.papel === "OWNER" || Number(viewer?.id) === Number(targetId);
}

function avatarKey(id, extension) {
  return `admin-${id}-${crypto.randomUUID()}.${extension}`;
}

export async function onRequestPost({ request, env, params }) {
  if (!sameOrigin(request)) return json({ erro: "Origem inválida." }, 403);
  const auth = await requireUser(env, request);
  if (auth.error) return auth.error;
  if (!env.PRODUCT_IMAGES) return json({ erro: "Storage de imagens não configurado." }, 503);

  const id = validId(params.id);
  if (!id) return json({ erro: "ID inválido." }, 400);
  if (!canManageAvatar(auth.user, id)) return json({ erro: "Sem permissão para alterar esta foto." }, 403);

  const user = await env.DB.prepare("SELECT id, avatar_key FROM usuarios_admin WHERE id = ?")
    .bind(id)
    .first();
  if (!user) return json({ erro: "Administrador não encontrado." }, 404);

  const form = await request.formData().catch(() => null);
  const file = form?.get("image");
  if (!(file instanceof File)) return json({ erro: "Envie uma imagem válida." }, 400);
  if (!ALLOWED_TYPES.has(file.type)) return json({ erro: "Use JPG, PNG ou WebP." }, 415);
  if (file.size < 1 || file.size > MAX_IMAGE_BYTES)
    return json({ erro: "A imagem deve ter no máximo 5 MB." }, 413);

  const extension = ALLOWED_TYPES.get(file.type);
  const key = avatarKey(id, extension);
  await env.PRODUCT_IMAGES.put(key, await file.arrayBuffer(), {
    httpMetadata: {
      contentType: file.type,
      cacheControl: "public, max-age=31536000, immutable"
    },
    customMetadata: {
      adminId: String(id),
      uploadedBy: String(auth.user?.id || "")
    }
  });

  try {
    await env.DB.prepare("UPDATE usuarios_admin SET avatar_key = ? WHERE id = ?").bind(key, id).run();
  } catch (error) {
    await env.PRODUCT_IMAGES.delete(key).catch(() => {});
    throw error;
  }

  if (user.avatar_key && user.avatar_key !== key) {
    await env.PRODUCT_IMAGES.delete(user.avatar_key).catch(() => {});
  }

  return json({ ok: true, avatar_key: key, avatar_url: `/api/images/${encodeURIComponent(key)}` });
}

export async function onRequestDelete({ request, env, params }) {
  if (!sameOrigin(request)) return json({ erro: "Origem inválida." }, 403);
  const auth = await requireUser(env, request);
  if (auth.error) return auth.error;
  if (!env.PRODUCT_IMAGES) return json({ erro: "Storage de imagens não configurado." }, 503);

  const id = validId(params.id);
  if (!id) return json({ erro: "ID inválido." }, 400);
  if (!canManageAvatar(auth.user, id)) return json({ erro: "Sem permissão para alterar esta foto." }, 403);

  const user = await env.DB.prepare("SELECT id, avatar_key FROM usuarios_admin WHERE id = ?")
    .bind(id)
    .first();
  if (!user) return json({ erro: "Administrador não encontrado." }, 404);

  await env.DB.prepare("UPDATE usuarios_admin SET avatar_key = NULL WHERE id = ?").bind(id).run();
  if (user.avatar_key) await env.PRODUCT_IMAGES.delete(user.avatar_key).catch(() => {});
  return json({ ok: true });
}
