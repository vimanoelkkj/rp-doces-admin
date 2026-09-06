import { loadAppConfig } from "../lib/app-config.js";

export async function onRequestGet({ env, request }) {
  const config = await loadAppConfig(env);
  const etag = `"rp-app-config-${config.revision}"`;

  if (request.headers.get("If-None-Match") === etag) {
    return new Response(null, {
      status: 304,
      headers: {
        ETag: etag,
        "Cache-Control": "no-cache, max-age=0, must-revalidate"
      }
    });
  }

  return Response.json(config, {
    headers: {
      ETag: etag,
      "Cache-Control": "no-cache, max-age=0, must-revalidate"
    }
  });
}
