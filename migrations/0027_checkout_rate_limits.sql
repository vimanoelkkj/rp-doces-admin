-- Rate limit dedicado ao checkout público.
-- Uma chave representa um IP dentro de uma janela fixa de 60 segundos.

CREATE TABLE checkout_rate_limits (
  chave TEXT PRIMARY KEY,
  tentativas INTEGER NOT NULL DEFAULT 0 CHECK (tentativas >= 0),
  expira_em INTEGER NOT NULL,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_checkout_rate_limits_expira
  ON checkout_rate_limits(expira_em);
