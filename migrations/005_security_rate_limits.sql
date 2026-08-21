CREATE TABLE IF NOT EXISTS auth_rate_limits (
  chave TEXT PRIMARY KEY,
  falhas INTEGER NOT NULL DEFAULT 0,
  janela_inicio TEXT NOT NULL,
  bloqueado_ate TEXT,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_auth_rate_limits_bloqueado
ON auth_rate_limits(bloqueado_ate);
