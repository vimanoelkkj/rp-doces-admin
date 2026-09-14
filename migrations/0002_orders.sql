CREATE TABLE pedidos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_publico TEXT NOT NULL UNIQUE,
  cliente_nome TEXT NOT NULL,
  cliente_whatsapp TEXT NOT NULL,
  recado TEXT NOT NULL DEFAULT '',
  valor_total_centavos INTEGER NOT NULL CHECK (valor_total_centavos >= 0),
  status_pagamento TEXT NOT NULL DEFAULT 'PENDENTE'
    CHECK (status_pagamento IN ('PENDENTE', 'PAGO', 'CANCELADO', 'EXPIRADO')),
  status_preparo TEXT NOT NULL DEFAULT 'RECEBIDO'
    CHECK (status_preparo IN ('RECEBIDO', 'EM_PREPARACAO', 'PRONTO_PARA_RETIRADA', 'RETIRADO')),
  mp_payment_id TEXT UNIQUE,
  mp_status TEXT,
  mp_qr_code TEXT,
  mp_qr_code_base64 TEXT,
  mp_ticket_url TEXT,
  pix_expira_em TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  pago_em TEXT
);

CREATE INDEX idx_pedidos_status_pagamento ON pedidos(status_pagamento, criado_em);
CREATE INDEX idx_pedidos_mp_payment_id ON pedidos(mp_payment_id);

CREATE TABLE pedido_itens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pedido_id INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  produto_id INTEGER REFERENCES produtos(id) ON DELETE SET NULL,
  produto_nome TEXT NOT NULL,
  quantidade INTEGER NOT NULL CHECK (quantidade >= 1 AND quantidade <= 50),
  valor_unitario_centavos INTEGER NOT NULL CHECK (valor_unitario_centavos >= 0),
  valor_total_centavos INTEGER NOT NULL CHECK (valor_total_centavos >= 0)
);

CREATE INDEX idx_pedido_itens_pedido ON pedido_itens(pedido_id);
