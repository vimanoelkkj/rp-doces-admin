export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers
    }
  });
}

export async function bodyJson(request, maxBytes = 16384) {
  try {
    const len = Number(request.headers.get("content-length") || 0);
    if (len > maxBytes) return null;
    const text = await request.text();
    if (text.length > maxBytes) return null;
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

export function sameOrigin(request) {
  const expected = new URL(request.url).origin;
  const origin = request.headers.get("Origin");
  if (origin) return origin === expected;

  // Fallback para navegadores/proxies que omitem Origin.
  const referer = request.headers.get("Referer");
  if (referer) {
    try {
      return new URL(referer).origin === expected;
    } catch {
      return false;
    }
  }

  // Para métodos mutáveis, ausência dos dois cabeçalhos é rejeitada.
  return ["GET", "HEAD", "OPTIONS"].includes(request.method);
}
