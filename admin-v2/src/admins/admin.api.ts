import { z } from "zod";
import { requestJson } from "../shared/apiClient";
import { sqliteBoolean } from "../shared/sqliteTypes";
import type { AdminRole, AdminUser, CreateAdminInput } from "./admin.types";

const AdminRoleSchema = z.enum(["OWNER", "ADMIN"]);

const AdminUserSchema = z.object({
  id: z.number(),
  nome: z.string(),
  username: z.string(),
  email: z.string().nullable(),
  ativo: sqliteBoolean,
  papel: AdminRoleSchema,
  criado_em: z.string().nullable().optional().default(null),
  avatar_key: z.string().nullable().optional().default(null),
  avatar_url: z.string().nullable().optional().default(null)
});

const UsersResponseSchema = z.object({ usuarios: z.array(AdminUserSchema) });
const OkSchema = z.object({ ok: z.literal(true) });

const PasswordSchema = z
  .string()
  .min(8, "A senha precisa ter pelo menos 8 caracteres.")
  .refine(value => /[A-Za-z]/.test(value) && /\d/.test(value), {
    message: "Use pelo menos uma letra e um número."
  });

const CreateAdminInputSchema = z
  .object({
    nome: z.string().trim().min(2, "Informe um nome com pelo menos 2 caracteres.").max(100, "O nome pode ter no máximo 100 caracteres."),
    username: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9._-]{3,30}$/, "Use de 3 a 30 caracteres no usuário: letras, números, ponto, hífen ou sublinhado."),
    email: z.string().trim().toLowerCase().max(254, "O e-mail pode ter no máximo 254 caracteres.").email("Informe um e-mail válido."),
    senha: PasswordSchema,
    papel: AdminRoleSchema
  })
  .strict();

function validationError(result: z.ZodSafeParseError<unknown>): Error {
  return new Error(result.error.issues[0]?.message || "Dados do administrador inválidos.");
}

function jsonBody(body: unknown): RequestInit {
  return { body: JSON.stringify(body) };
}

export async function listAdmins(): Promise<AdminUser[]> {
  return UsersResponseSchema.parse(
    await requestJson("/api/admin/users", {}, "Não foi possível carregar os administradores.")
  ).usuarios;
}

export async function createAdmin(input: CreateAdminInput): Promise<void> {
  const parsed = CreateAdminInputSchema.safeParse(input);
  if (!parsed.success) throw validationError(parsed);

  OkSchema.parse(
    await requestJson(
      "/api/admin/users",
      { method: "POST", ...jsonBody(parsed.data) },
      "Não foi possível criar o administrador."
    )
  );
}

export async function resetAdminPassword(id: number, senha: string): Promise<void> {
  const parsed = PasswordSchema.safeParse(senha);
  if (!parsed.success) throw validationError(parsed);

  OkSchema.parse(
    await requestJson(
      `/api/admin/users/${id}`,
      {
        method: "PUT",
        ...jsonBody({ acao: "resetar_senha", senha: parsed.data })
      },
      "Não foi possível alterar a senha."
    )
  );
}

export async function setAdminActive(id: number, ativo: boolean): Promise<void> {
  OkSchema.parse(
    await requestJson(
      `/api/admin/users/${id}`,
      {
        method: "PUT",
        ...jsonBody({ acao: "toggle_ativo", ativo })
      },
      "Não foi possível alterar o estado da conta."
    )
  );
}

export async function setAdminRole(id: number, papel: AdminRole): Promise<void> {
  OkSchema.parse(
    await requestJson(
      `/api/admin/users/${id}`,
      {
        method: "PUT",
        ...jsonBody({ acao: "alterar_papel", papel })
      },
      "Não foi possível alterar o nível de acesso."
    )
  );
}
