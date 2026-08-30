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

function imageKey(id, extension) {
  return `product-${id}-${crypto.randomUUID()}.${extension}`;
}

export async function onRequestPost({ request, env, params }) {
  if (!sameOrigin(request)) return json({ erro: "Origem inválida." }, 403);
  const auth = await requireUser(env, request);
  if (auth.error) return auth.error;
  if (!env.PRODUCT_IMAGES) return json({ erro: "Storage de imagens não configurado." }, 503);

  const id = validId(params.id);
  if (!id) return json({ erro: "ID inválido." }, 400);

  const product = await env.DB.prepare("SELECT id, image_key FROM produtos WHERE id = ?")
    .bind(id)
    .first();
  if (!product) return json({ erro: "Produto não encontrado." }, 404);

  const form = await request.formData().catch(() => null);
  const file = form?.get("image");
  if (!(file instanceof File)) return json({ erro: "Envie uma imagem válida." }, 400);
  if (!ALLOWED_TYPES.has(file.type)) return json({ erro: "Use JPG, PNG ou WebP." }, 415);
  if (file.size < 1 || file.size > MAX_IMAGE_BYTES)
    return json({ erro: "A imagem deve ter no máximo 5 MB." }, 413);

  const extension = ALLOWED_TYPES.get(file.type);
  const key = imageKey(id, extension);
  const bytes = await file.arrayBuffer();

  await env.PRODUCT_IMAGES.put(key, bytes, {
    httpMetadata: {
      contentType: file.type,
      cacheControl: "public, max-age=31536000, immutable"
    },
    customMetadata: {
      productId: String(id),
      uploadedBy: String(auth.user?.id || "")
    }
  });

  try {
    await env.DB.prepare(
      "UPDATE produtos SET image_key = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?"
    )
      .bind(key, id)
      .run();
  } catch (error) {
    await env.PRODUCT_IMAGES.delete(key).catch(() => {});
    throw error;
  }

  if (product.image_key && product.image_key !== key) {
    await env.PRODUCT_IMAGES.delete(product.image_key).catch(() => {});
  }

  return json({ ok: true, image_key: key, image_url: `/api/images/${encodeURIComponent(key)}` });
}

export async function onRequestDelete({ request, env, params }) {
  if (!sameOrigin(request)) return json({ erro: "Origem inválida." }, 403);
  const auth = await requireUser(env, request);
  if (auth.error) return auth.error;
  if (!env.PRODUCT_IMAGES) return json({ erro: "Storage de imagens não configurado." }, 503);

  const id = validId(params.id);
  if (!id) return json({ erro: "ID inválido." }, 400);

  const product = await env.DB.prepare("SELECT image_key FROM produtos WHERE id = ?")
    .bind(id)
    .first();
  if (!product) return json({ erro: "Produto não encontrado." }, 404);

  await env.DB.prepare(
    "UPDATE produtos SET image_key = NULL, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?"
  )
    .bind(id)
    .run();

  if (product.image_key) await env.PRODUCT_IMAGES.delete(product.image_key).catch(() => {});
  return json({ ok: true });
}
