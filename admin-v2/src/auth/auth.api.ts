import { z } from "zod";
import { sqliteBoolean } from "../shared/sqliteTypes";

const SessionUserSchema = z.object({
  id: z.number(),
  nome: z.string(),
  username: z.string(),
  email: z.string().nullable(),
  ativo: sqliteBoolean,
  papel: z.string(),
  avatar_key: z.string().nullable(),
  avatar_url: z.string().nullable()
});

const LoginUserSchema = SessionUserSchema.pick({
  id: true,
  nome: true,
  username: true,
  email: true
});

const MeSchema = z.object({
  autenticado: z.literal(true),
  usuario: SessionUserSchema
});

const LoginSchema = z.object({
  ok: z.literal(true),
  usuario: LoginUserSchema
});

const LogoutSchema = z.object({
  ok: z.literal(true)
});

export type AuthUser = z.infer<typeof SessionUserSchema>;
export type LoginUser = z.infer<typeof LoginUserSchema>;

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

export async function login(username: string, senha: string): Promise<LoginUser> {
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

  return LoginSchema.parse(body).usuario;
}

export async function logout(): Promise<void> {
  const response = await fetch("/api/auth/logout", {
    method: "POST",
    credentials: "include",
    headers: { accept: "application/json" }
  });

  const body = await readJson(response);
  if (!response.ok) {
    throw new AuthError(errorMessage(body, "Não foi possível sair."), response.status);
  }

  LogoutSchema.parse(body);
}
