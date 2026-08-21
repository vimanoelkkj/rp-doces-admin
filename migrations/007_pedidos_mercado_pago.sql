CREATE TABLE IF NOT EXISTS pedidos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_publico TEXT NOT NULL UNIQUE,
  produto_id INTEGER NOT NULL,
  produto_nome TEXT NOT NULL,
  quantidade INTEGER NOT NULL CHECK (quantidade >= 1 AND quantidade <= 50),
  valor_unitario_centavos INTEGER NOT NULL CHECK (valor_unitario_centavos >= 0),
  valor_total_centavos INTEGER NOT NULL CHECK (valor_total_centavos >= 0),
  cliente_nome TEXT NOT NULL,
  cliente_email TEXT NOT NULL,
  observacao TEXT NOT NULL DEFAULT '',
  metodo_pagamento TEXT NOT NULL DEFAULT 'PIX',
  status_pagamento TEXT NOT NULL DEFAULT 'PENDENTE',
  mp_order_id TEXT UNIQUE,
  mp_payment_id TEXT,
  mp_status TEXT,
  mp_status_detail TEXT,
  mp_ticket_url TEXT,
  mp_qr_code TEXT,
  mp_qr_code_base64 TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  pago_em TEXT,
  FOREIGN KEY (produto_id) REFERENCES produtos(id)
);

CREATE INDEX IF NOT EXISTS idx_pedidos_mp_order_id ON pedidos(mp_order_id);
CREATE INDEX IF NOT EXISTS idx_pedidos_status_pagamento ON pedidos(status_pagamento, criado_em);
