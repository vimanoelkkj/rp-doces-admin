-- Credenciais WebAuthn do painel administrativo. A biometria permanece no
-- autenticador; o banco armazena somente a chave pública e metadados.
CREATE TABLE IF NOT EXISTS admin_passkeys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER NOT NULL,
  credential_id TEXT NOT NULL UNIQUE,
  public_key BLOB NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0 CHECK (counter >= 0),
  transports TEXT NOT NULL DEFAULT '[]',
  device_type TEXT NOT NULL,
  backed_up INTEGER NOT NULL DEFAULT 0 CHECK (backed_up IN (0,1)),
  rp_id TEXT NOT NULL,
  nome TEXT NOT NULL DEFAULT 'Biometria',
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ultimo_uso_em TEXT,
  FOREIGN KEY (usuario_id) REFERENCES usuarios_admin(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_admin_passkeys_usuario
ON admin_passkeys(usuario_id);

CREATE INDEX IF NOT EXISTS idx_admin_passkeys_rp
ON admin_passkeys(rp_id, usuario_id);

-- Desafios são curtos, vinculados ao usuário, à cerimônia e à origem. O
-- endpoint os remove antes da verificação para impedir reutilização concorrente.
CREATE TABLE IF NOT EXISTS admin_passkey_challenges (
  id TEXT PRIMARY KEY,
  usuario_id INTEGER NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('REGISTRO','LOGIN')),
  challenge TEXT NOT NULL,
  rp_id TEXT NOT NULL,
  origin TEXT NOT NULL,
  expira_em TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (usuario_id) REFERENCES usuarios_admin(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_admin_passkey_challenges_expira
ON admin_passkey_challenges(expira_em);
