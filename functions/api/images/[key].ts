/// <reference types="@cloudflare/workers-types" />

interface Env {
  PRODUCT_IMAGES: R2Bucket;
}

const KEY_PATTERN = /^product-\d+-[0-9a-f-]+\.(?:jpg|png|webp)$/i;

export const onRequestGet: PagesFunction<Env> = async ({ env, params }) => {
  if (!env.PRODUCT_IMAGES) {
    return new Response("Not found", { status: 404 });
  }

  const key = String(params.key ?? "");
  if (!KEY_PATTERN.test(key)) {
    return new Response("Not found", { status: 404 });
  }

  const object = await env.PRODUCT_IMAGES.get(key);
  if (!object) {
    return new Response("Not found", { status: 404 });
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "public, max-age=31536000, immutable");
  headers.set("x-content-type-options", "nosniff");

  return new Response(object.body, { headers });
};
