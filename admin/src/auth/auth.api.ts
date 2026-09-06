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

const IdentifiedUserSchema = z.object({
  nome: z.string(),
  username: z.string(),
  avatar_url: z.string().nullable()
});

const IdentifySchema = z.union([
  z.object({ encontrado: z.literal(false) }),
  z.object({ encontrado: z.literal(true), usuario: IdentifiedUserSchema })
]);

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

const PasskeyBeginSchema = z.object({
  options: z.object({
    challenge: z.string(),
    allowCredentials: z
      .array(
        z.object({
          id: z.string(),
          type: z.literal("public-key").optional(),
          transports: z.array(z.string()).optional()
        }).passthrough()
      )
      .optional()
  }).passthrough(),
  challenge_id: z.string()
});

const PasskeyFinishSchema = z.object({ ok: z.literal(true) });

export type AuthUser = z.infer<typeof SessionUserSchema>;
export type LoginUser = z.infer<typeof LoginUserSchema>;
export type IdentifiedUser = z.infer<typeof IdentifiedUserSchema>;
export type PasskeyBegin = z.infer<typeof PasskeyBeginSchema>;

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

async function postJson(path: string, body: unknown, fallback: string): Promise<unknown> {
  const response = await fetch(path, {
    method: "POST",
    credentials: "include",
    headers: {
      accept: "application/json",
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const payload = await readJson(response);
  if (!response.ok) {
    throw new AuthError(errorMessage(payload, fallback), response.status);
  }
  return payload;
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

export async function identify(username: string): Promise<IdentifiedUser | null> {
  const result = IdentifySchema.parse(
    await postJson("/api/auth/identify", { username }, "Não foi possível localizar a conta.")
  );
  return result.encontrado ? result.usuario : null;
}

export async function login(username: string, senha: string): Promise<LoginUser> {
  return LoginSchema.parse(
    await postJson("/api/auth/login", { username, senha }, "Não foi possível entrar.")
  ).usuario;
}

export async function beginPasskeyLogin(): Promise<PasskeyBegin> {
  return PasskeyBeginSchema.parse(
    await postJson("/api/auth/passkey", { acao: "opcoes" }, "Não foi possível usar a biometria.")
  );
}

export async function finishPasskeyLogin(challengeId: string, response: unknown): Promise<void> {
  PasskeyFinishSchema.parse(
    await postJson(
      "/api/auth/passkey",
      { acao: "verificar", challenge_id: challengeId, response },
      "Não foi possível usar a biometria."
    )
  );
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
