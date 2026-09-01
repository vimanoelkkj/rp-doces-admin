import { z } from "zod";

const UserSchema = z.object({
  id: z.number(),
  nome: z.string(),
  username: z.string(),
  email: z.string().nullable().optional(),
  ativo: z.union([z.literal(0), z.literal(1), z.boolean()]).optional(),
  papel: z.string().optional(),
  avatar_key: z.string().nullable().optional(),
  avatar_url: z.string().nullable().optional()
});

const MeSchema = z.object({
  autenticado: z.literal(true),
  usuario: UserSchema
});

const LoginSchema = z.object({
  ok: z.literal(true),
  usuario: UserSchema.pick({
    id: true,
    nome: true,
    username: true,
    email: true
  })
});

export type AuthUser = z.infer<typeof UserSchema>;

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = "AuthError";
  }
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new AuthError("Resposta inválida do servidor.", response.status);
  }
}

function errorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "erro" in body && typeof body.erro === "string") {
    return body.erro;
  }
  return fallback;
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  const response = await fetch("/api/auth/me", {
    credentials: "include",
    headers: { accept: "application/json" }
  });

  if (response.status === 401) return null;
  const body = await readJson(response);
  if (!response.ok) {
    throw new AuthError(errorMessage(body, "Não foi possível verificar a sessão."), response.status);
  }

  return MeSchema.parse(body).usuario;
}

export async function login(username: string, senha: string): Promise<AuthUser> {
  const response = await fetch("/api/auth/login", {
    method: "POST",
    credentials: "include",
    headers: {
      accept: "application/json",
      "content-type": "application/json"
    },
    body: JSON.stringify({ username, senha })
  });

  const body = await readJson(response);
  if (!response.ok) {
    throw new AuthError(errorMessage(body, "Não foi possível entrar."), response.status);
  }

  const parsed = LoginSchema.parse(body);
  return parsed.usuario;
}
