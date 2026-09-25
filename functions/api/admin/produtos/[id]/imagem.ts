/// <reference types="@cloudflare/workers-types" />

import { requireUser, sameOrigin } from "../../../../lib/auth";

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

function detectImageType(bytes: ArrayBuffer): string | null {
  const data = new Uint8Array(bytes);

  if (
    data.length >= 3 &&
    data[0] === 0xff &&
    data[1] === 0xd8 &&
    data[2] === 0xff
  ) {
    return "image/jpeg";
  }

  if (
    data.length >= 8 &&
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47 &&
    data[4] === 0x0d &&
    data[5] === 0x0a &&
    data[6] === 0x1a &&
    data[7] === 0x0a
  ) {
    return "image/png";
  }

  if (
    data.length >= 12 &&
    data[0] === 0x52 &&
    data[1] === 0x49 &&
    data[2] === 0x46 &&
    data[3] === 0x46 &&
    data[8] === 0x57 &&
    data[9] === 0x45 &&
    data[10] === 0x42 &&
    data[11] === 0x50
  ) {
    return "image/webp";
  }

  return null;
}

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function imageKey(id: number, extension: string): string {
  return `product-${id}-${crypto.randomUUID()}.${extension}`;
}

export const onRequestPost: PagesFunction<Env> = async ({
  request,
  env,
  params,
}) => {
  if (!sameOrigin(request)) return jsonError("Origem inválida", 403);

  const auth = await requireUser(env.DB, request);
  if ("error" in auth) return auth.error;

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

    // O tipo padrão do @cloudflare/workers-types declara `get(): string | null`
    // (runtime anterior a 2021-11-03). Com a compatibility_date do projeto o
    // upload chega como File; `unknown` + instanceof valida isso em runtime.
    const file: unknown = form.get("image");
    if (!(file instanceof File)) {
      return jsonError("Envie uma imagem válida", 400);
    }
    if (!ALLOWED_TYPES.has(file.type)) {
      return jsonError("Use JPG, PNG ou WebP", 415);
    }
    if (file.size < 1 || file.size > MAX_IMAGE_BYTES) {
      return jsonError("A imagem deve ter no máximo 5 MB", 413);
    }

    const bytes = await file.arrayBuffer();
    const detectedType = detectImageType(bytes);
    if (!detectedType || detectedType !== file.type) {
      return jsonError(
        "O conteúdo do arquivo não corresponde ao tipo de imagem informado",
        415,
      );
    }

    const extension = ALLOWED_TYPES.get(detectedType)!;
    const key = imageKey(id, extension);

    await env.PRODUCT_IMAGES.put(key, bytes, {
      httpMetadata: {
        contentType: detectedType,
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

export const onRequestDelete: PagesFunction<Env> = async ({
  request,
  env,
  params,
}) => {
  if (!sameOrigin(request)) return jsonError("Origem inválida", 403);

  const auth = await requireUser(env.DB, request);
  if ("error" in auth) return auth.error;

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
