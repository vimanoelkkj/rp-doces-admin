import { json } from "../lib/http.js";

export async function onRequest(context) {
  const response = await context.next();

  // Nunca deixe uma rota /api inexistente cair no fallback HTML da SPA.
  // Endpoints válidos continuam retornando suas respostas normalmente.
  const contentType = response.headers.get("content-type") || "";
  if (contentType.toLowerCase().includes("text/html")) {
    return json({ erro: "Rota não encontrada." }, 404);
  }

  return response;
}
