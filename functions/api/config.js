const DEFAULT_PRODUCTION_ORIGIN = "https://rp-doces.pages.dev";

function isLocalRequest(request) {
  try {
    const hostname = new URL(request.url).hostname;
    return hostname === "127.0.0.1" || hostname === "localhost";
  } catch {
    return false;
  }
}

function productionOrigin(env) {
  return String(env.PRODUCTION_CATALOG_ORIGIN || DEFAULT_PRODUCTION_ORIGIN).replace(/\/$/, "");
}

export async function onRequestGet({ env, request }) {
  if (isLocalRequest(request)) {
    const response = await fetch(`${productionOrigin(env)}/api/config`, {
      headers: { Accept: "application/json" },
      cf: { cacheTtl: 0 }
    });

    if (!response.ok) {
      return Response.json({}, { status: response.status, headers: { "Cache-Control": "no-store" } });
    }

    const config = await response.json();
    return Response.json(config, {
      headers: { "Cache-Control": "no-store" }
    });
  }

  const rows = await env.DB.prepare("SELECT chave, valor FROM configuracoes_loja").all();
  const config = Object.fromEntries((rows.results || []).map(r => [r.chave, r.valor]));
  return Response.json(config, {
    headers: { "Cache-Control": "no-store" }
  });
}
