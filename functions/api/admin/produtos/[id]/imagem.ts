/// <reference types="@cloudflare/workers-types" />

interface Env {
  DB: D1Database;
  PRODUCT_IMAGES: R2Bucket;
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function imageKey(id: number, extension: string): string {
  return `product-${id}-${crypto.randomUUID()}.${extension}`;
}

// TODO(admin auth): proteger este endpoint quando a autenticação administrativa existir.
export const onRequestPost: PagesFunction<Env> = async ({
  request,
  env,
  params,
}) => {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return jsonError("Id inválido", 400);
  }
  if (!env.PRODUCT_IMAGES) {
    return jsonError("Storage de imagens não configurado", 503);
  }

  try {
    const produto = await env.DB.prepare(
      `SELECT id, image_key FROM produtos WHERE id = ?`,
    )
      .bind(id)
      .first<{ id: number; image_key: string | null }>();

    if (!produto) {
      return jsonError("Produto não encontrado", 404);
    }

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return jsonError("Envie a imagem como multipart/form-data", 400);
    }

    const file = form.get("image");
    if (!(file instanceof File)) {
      return jsonError("Envie uma imagem válida", 400);
    }
    if (!ALLOWED_TYPES.has(file.type)) {
      return jsonError("Use JPG, PNG ou WebP", 415);
    }
    if (file.size < 1 || file.size > MAX_IMAGE_BYTES) {
      return jsonError("A imagem deve ter no máximo 5 MB", 413);
    }

    const extension = ALLOWED_TYPES.get(file.type)!;
    const key = imageKey(id, extension);
    const bytes = await file.arrayBuffer();

    await env.PRODUCT_IMAGES.put(key, bytes, {
      httpMetadata: {
        contentType: file.type,
        cacheControl: "public, max-age=31536000, immutable",
      },
      customMetadata: { productId: String(id) },
    });

    try {
      await env.DB.prepare(
        `UPDATE produtos SET image_key = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?`,
      )
        .bind(key, id)
        .run();
    } catch (err) {
      await env.PRODUCT_IMAGES.delete(key).catch(() => {});
      throw err;
    }

    if (produto.image_key && produto.image_key !== key) {
      await env.PRODUCT_IMAGES.delete(produto.image_key).catch(() => {});
    }

    return Response.json({
      ok: true,
      imageKey: key,
      imageUrl: `/api/images/${encodeURIComponent(key)}`,
    });
  } catch (err) {
    console.error("Erro ao enviar imagem do produto (admin)", err);
    return jsonError("Erro interno ao enviar imagem", 500);
  }
};

// TODO(admin auth): proteger este endpoint quando a autenticação administrativa existir.
export const onRequestDelete: PagesFunction<Env> = async ({ env, params }) => {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return jsonError("Id inválido", 400);
  }
  if (!env.PRODUCT_IMAGES) {
    return jsonError("Storage de imagens não configurado", 503);
  }

  try {
    const produto = await env.DB.prepare(
      `SELECT image_key FROM produtos WHERE id = ?`,
    )
      .bind(id)
      .first<{ image_key: string | null }>();

    if (!produto) {
      return jsonError("Produto não encontrado", 404);
    }

    await env.DB.prepare(
      `UPDATE produtos SET image_key = NULL, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?`,
    )
      .bind(id)
      .run();

    if (produto.image_key) {
      await env.PRODUCT_IMAGES.delete(produto.image_key).catch(() => {});
    }

    return Response.json({ ok: true });
  } catch (err) {
    console.error("Erro ao remover imagem do produto (admin)", err);
    return jsonError("Erro interno ao remover imagem", 500);
  }
};
