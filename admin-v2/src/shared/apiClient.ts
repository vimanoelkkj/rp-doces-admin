export class ApiClientError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

export async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    throw new ApiClientError("Resposta inválida do servidor.", response.status);
  }
}

export function apiErrorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object") {
    if ("erro" in body && typeof body.erro === "string") return body.erro;
    if ("message" in body && typeof body.message === "string") return body.message;
  }
  return fallback;
}

export async function requestJson(
  path: string,
  init: RequestInit = {},
  fallback = "Não foi possível comunicar com o servidor."
): Promise<unknown> {
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers: {
      accept: "application/json",
      ...(init.body && !(init.body instanceof FormData) ? { "content-type": "application/json" } : {}),
      ...init.headers
    }
  });

  const body = await readJson(response);
  if (!response.ok) {
    throw new ApiClientError(apiErrorMessage(body, fallback), response.status);
  }
  return body;
}
