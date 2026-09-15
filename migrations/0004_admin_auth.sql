CREATE TABLE usuarios_admin (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  username TEXT NOT NULL COLLATE NOCASE,
  email TEXT NOT NULL COLLATE NOCASE,
  senha_hash TEXT NOT NULL,
  papel TEXT NOT NULL DEFAULT 'ADMIN' CHECK (papel IN ('OWNER', 'ADMIN')),
  ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX idx_usuarios_admin_username ON usuarios_admin(username COLLATE NOCASE);
CREATE UNIQUE INDEX idx_usuarios_admin_email ON usuarios_admin(email COLLATE NOCASE);
CREATE INDEX idx_usuarios_admin_papel_ativo ON usuarios_admin(papel, ativo);

CREATE TABLE admin_sessoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER NOT NULL REFERENCES usuarios_admin(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expira_em TEXT NOT NULL
);

CREATE INDEX idx_admin_sessoes_token ON admin_sessoes(token_hash);
CREATE INDEX idx_admin_sessoes_usuario ON admin_sessoes(usuario_id);

CREATE TABLE auth_rate_limits (
  chave TEXT PRIMARY KEY,
  falhas INTEGER NOT NULL DEFAULT 0,
  janela_inicio TEXT NOT NULL,
  bloqueado_ate TEXT,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_auth_rate_limits_bloqueado ON auth_rate_limits(bloqueado_ate);
