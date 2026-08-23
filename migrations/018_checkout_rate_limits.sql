-- Tabela para controle atômico de rate limiting do checkout Pix
CREATE TABLE IF NOT EXISTS checkout_rate_limits (
  chave TEXT PRIMARY KEY,
  tentativas INTEGER NOT NULL DEFAULT 1,
  expira_em INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_checkout_rate_limits_expira
ON checkout_rate_limits(expira_em);
