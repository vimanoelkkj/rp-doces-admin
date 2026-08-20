ALTER TABLE produtos ADD COLUMN emoji TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS usuarios_admin (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  senha_hash TEXT NOT NULL,
  ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0,1)),
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS admin_sessoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expira_em TEXT NOT NULL,
  FOREIGN KEY (usuario_id) REFERENCES usuarios_admin(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_admin_sessoes_token ON admin_sessoes(token_hash);
CREATE INDEX IF NOT EXISTS idx_admin_sessoes_usuario ON admin_sessoes(usuario_id);

CREATE TABLE IF NOT EXISTS tokens_recuperacao (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expira_em TEXT NOT NULL,
  usado INTEGER NOT NULL DEFAULT 0 CHECK (usado IN (0,1)),
  FOREIGN KEY (usuario_id) REFERENCES usuarios_admin(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tokens_recuperacao_hash ON tokens_recuperacao(token_hash);
