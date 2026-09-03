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

function jsonBody(body: unknown): RequestInit {
  return {
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  };
}

export async function listAdmins(): Promise<AdminUser[]> {
  return UsersResponseSchema.parse(
    await requestJson("/api/admin/users", {}, "Não foi possível carregar os administradores.")
  ).usuarios;
}

export async function createAdmin(input: CreateAdminInput): Promise<void> {
  OkSchema.parse(
    await requestJson(
      "/api/admin/users",
      { method: "POST", ...jsonBody(input) },
      "Não foi possível criar o administrador."
    )
  );
}

export async function resetAdminPassword(id: number, senha: string): Promise<void> {
  OkSchema.parse(
    await requestJson(
      `/api/admin/users/${id}`,
      {
        method: "PUT",
        ...jsonBody({ acao: "resetar_senha", senha })
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
