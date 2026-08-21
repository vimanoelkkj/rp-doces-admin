-- Permite excluir definitivamente um produto sem apagar o histórico dos pedidos.
-- Os pedidos já armazenam nome/preço/quantidade como snapshot; produto_id passa a
-- ser apenas uma referência opcional ao produto ainda existente no catálogo.

CREATE TABLE pedidos__novo (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_publico TEXT NOT NULL UNIQUE,
  produto_id INTEGER,
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
  status_pedido TEXT NOT NULL DEFAULT 'NOVO',
  cliente_whatsapp TEXT NOT NULL DEFAULT '',
  tipo_entrega TEXT NOT NULL DEFAULT 'RETIRADA',
  estoque_baixado_em TEXT,
  arquivado INTEGER NOT NULL DEFAULT 0,
  arquivado_em TEXT,
  FOREIGN KEY (produto_id) REFERENCES produtos(id) ON DELETE SET NULL
);

INSERT INTO pedidos__novo (
  id, token_publico, produto_id, produto_nome, quantidade,
  valor_unitario_centavos, valor_total_centavos, cliente_nome, cliente_email,
  observacao, metodo_pagamento, status_pagamento, mp_order_id, mp_payment_id,
  mp_status, mp_status_detail, mp_ticket_url, mp_qr_code, mp_qr_code_base64,
  idempotency_key, criado_em, atualizado_em, pago_em, status_pedido,
  cliente_whatsapp, tipo_entrega, estoque_baixado_em, arquivado, arquivado_em
)
SELECT
  id, token_publico, produto_id, produto_nome, quantidade,
  valor_unitario_centavos, valor_total_centavos, cliente_nome, cliente_email,
  observacao, metodo_pagamento, status_pagamento, mp_order_id, mp_payment_id,
  mp_status, mp_status_detail, mp_ticket_url, mp_qr_code, mp_qr_code_base64,
  idempotency_key, criado_em, atualizado_em, pago_em, status_pedido,
  cliente_whatsapp, tipo_entrega, estoque_baixado_em, 0, NULL
FROM pedidos;

DROP TABLE pedidos;
ALTER TABLE pedidos__novo RENAME TO pedidos;

CREATE INDEX IF NOT EXISTS idx_pedidos_mp_order_id ON pedidos(mp_order_id);
CREATE INDEX IF NOT EXISTS idx_pedidos_status_pagamento ON pedidos(status_pagamento, criado_em);
CREATE INDEX IF NOT EXISTS idx_pedidos_status_pedido ON pedidos(status_pedido, criado_em);
CREATE INDEX IF NOT EXISTS idx_pedidos_estoque_baixado ON pedidos(status_pagamento, estoque_baixado_em);
CREATE INDEX IF NOT EXISTS idx_pedidos_arquivado ON pedidos(arquivado, criado_em);
CREATE INDEX IF NOT EXISTS idx_pedidos_produto_id ON pedidos(produto_id);
