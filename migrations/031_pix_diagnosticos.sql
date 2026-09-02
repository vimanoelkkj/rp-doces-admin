CREATE TABLE IF NOT EXISTS pix_diagnosticos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  external_reference TEXT NOT NULL UNIQUE,
  mp_order_id TEXT UNIQUE,
  mp_payment_id TEXT,
  valor_centavos INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDENTE',
  mp_status TEXT,
  mp_status_detail TEXT,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  pago_em TEXT,
  webhook_recebido_em TEXT,
  webhook_data_id TEXT,
  webhook_request_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_pix_diagnosticos_order ON pix_diagnosticos(mp_order_id);
CREATE INDEX IF NOT EXISTS idx_pix_diagnosticos_payment ON pix_diagnosticos(mp_payment_id);
