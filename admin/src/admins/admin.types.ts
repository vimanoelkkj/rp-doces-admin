export type AdminRole = "OWNER" | "ADMIN";

export type AdminUser = {
  id: number;
  nome: string;
  username: string;
  email: string | null;
  ativo: boolean;
  papel: AdminRole;
  criado_em: string | null;
  avatar_key: string | null;
  avatar_url: string | null;
};

export type CreateAdminInput = {
  nome: string;
  username: string;
  email: string;
  senha: string;
  papel: AdminRole;
};
