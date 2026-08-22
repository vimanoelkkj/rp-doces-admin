-- O login passwordless começa antes de sabermos qual administrador escolheu
-- uma passkey. Desafios são efêmeros, então a tabela pode ser recriada sem
-- preservar tentativas que estejam em andamento durante a atualização.
DROP TABLE IF EXISTS admin_passkey_challenges;

CREATE TABLE admin_passkey_challenges (
  id TEXT PRIMARY KEY,
  usuario_id INTEGER,
  tipo TEXT NOT NULL CHECK (tipo IN ('REGISTRO','LOGIN')),
  challenge TEXT NOT NULL,
  rp_id TEXT NOT NULL,
  origin TEXT NOT NULL,
  expira_em TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (usuario_id) REFERENCES usuarios_admin(id) ON DELETE CASCADE,
  CHECK (tipo = 'LOGIN' OR usuario_id IS NOT NULL)
);

CREATE INDEX idx_admin_passkey_challenges_expira
ON admin_passkey_challenges(expira_em);
