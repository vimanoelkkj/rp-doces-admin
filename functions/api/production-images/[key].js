const DEFAULT_PRODUCTION_ORIGIN = "https://rp-doces.pages.dev";

function productionOrigin(env) {
  return String(env.PRODUCTION_CATALOG_ORIGIN || DEFAULT_PRODUCTION_ORIGIN).replace(/\/$/, "");
}

function isLocalRequest(request) {
  try {
    const hostname = new URL(request.url).hostname;
    return hostname === "127.0.0.1" || hostname === "localhost";
  } catch {
    return false;
  }
}

export async function onRequestGet({ env, request, params }) {
  if (!isLocalRequest(request)) return new Response("Not found", { status: 404 });

  const key = String(params.key || "");
  if (!/^product-\d+-[0-9a-f-]+\.(?:jpg|png|webp)$/i.test(key)) {
    return new Response("Not found", { status: 404 });
  }

  const response = await fetch(`${productionOrigin(env)}/api/images/${encodeURIComponent(key)}`, {
    headers: { Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8" },
    cf: { cacheTtl: 0 }
  });

  if (!response.ok || !response.body) return new Response("Not found", { status: response.status });

  const headers = new Headers();
  const contentType = response.headers.get("content-type");
  const etag = response.headers.get("etag");
  if (contentType) headers.set("content-type", contentType);
  if (etag) headers.set("etag", etag);
  headers.set("cache-control", "no-store");
  headers.set("x-content-type-options", "nosniff");

  return new Response(response.body, { status: 200, headers });
}
