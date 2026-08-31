export async function onRequestGet({ env, params }) {
  if (!env.PRODUCT_IMAGES) return new Response("Not found", { status: 404 });

  const key = String(params.key || "");
  const productImage = /^product-\d+-[0-9a-f-]+\.(?:jpg|png|webp)$/i.test(key);
  const siteImage = /^site-(?:hero|about)-[0-9a-f-]+\.(?:jpg|png|webp)$/i.test(key);
  const adminAvatar = /^admin-\d+-[0-9a-f-]+\.(?:jpg|png|webp)$/i.test(key);
  if (!productImage && !siteImage && !adminAvatar)
    return new Response("Not found", { status: 404 });

  const object = await env.PRODUCT_IMAGES.get(key);
  if (!object) return new Response("Not found", { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "public, max-age=31536000, immutable");
  headers.set("x-content-type-options", "nosniff");

  return new Response(object.body, { headers });
}
