CREATE TABLE pedido_pagamentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pedido_id INTEGER NOT NULL,
  metodo TEXT NOT NULL CHECK (metodo IN ('PIX_MP','PIX_EXTERNO','CARTAO','DINHEIRO','A_COMBINAR')),
  origem TEXT NOT NULL CHECK (origem IN ('SITE','ADMIN')),
  valor_centavos INTEGER NOT NULL CHECK (valor_centavos > 0),
  status TEXT NOT NULL DEFAULT 'PENDENTE'
    CHECK (status IN ('PENDENTE','PAGO','CANCELADO','EXPIRADO','REEMBOLSADO','FALHOU')),
  mp_order_id TEXT,
  mp_payment_id TEXT,
  mp_status TEXT,
  mp_status_detail TEXT,
  mp_ticket_url TEXT,
  mp_qr_code TEXT,
  mp_qr_code_base64 TEXT,
  idempotency_key TEXT,
  substitui_pagamento_id INTEGER,
  registrado_por_usuario_id INTEGER,
  observacao TEXT NOT NULL DEFAULT '',
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  pago_em TEXT,
  cancelado_em TEXT,
  FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE CASCADE,
  FOREIGN KEY (substitui_pagamento_id) REFERENCES pedido_pagamentos(id) ON DELETE SET NULL,
  FOREIGN KEY (registrado_por_usuario_id) REFERENCES usuarios_admin(id) ON DELETE SET NULL
);

CREATE TABLE pedido_pagamento_alocacoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pagamento_id INTEGER NOT NULL,
  pedido_item_id INTEGER NOT NULL,
  valor_centavos INTEGER NOT NULL CHECK (valor_centavos > 0),
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (pagamento_id) REFERENCES pedido_pagamentos(id) ON DELETE CASCADE,
  FOREIGN KEY (pedido_item_id) REFERENCES pedido_itens(id) ON DELETE CASCADE,
  UNIQUE (pagamento_id, pedido_item_id)
);

CREATE INDEX idx_pedido_pagamentos_pedido_status
  ON pedido_pagamentos(pedido_id, status, criado_em);
CREATE INDEX idx_pedido_pagamento_alocacoes_pagamento
  ON pedido_pagamento_alocacoes(pagamento_id);
CREATE INDEX idx_pedido_pagamento_alocacoes_item
  ON pedido_pagamento_alocacoes(pedido_item_id);
CREATE UNIQUE INDEX uq_pedido_pagamentos_mp_order
  ON pedido_pagamentos(mp_order_id)
  WHERE mp_order_id IS NOT NULL;
CREATE UNIQUE INDEX uq_pedido_pagamentos_idempotency
  ON pedido_pagamentos(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Migra o estado financeiro atual para o novo livro-caixa sem remover os
-- campos legados de pedidos. Esses campos continuam sendo o espelho usado
-- pelo storefront/webhook durante a transição.
INSERT INTO pedido_pagamentos (
  pedido_id,
  metodo,
  origem,
  valor_centavos,
  status,
  mp_order_id,
  mp_payment_id,
  mp_status,
  mp_status_detail,
  mp_ticket_url,
  mp_qr_code,
  mp_qr_code_base64,
  idempotency_key,
  criado_em,
  atualizado_em,
  pago_em,
  cancelado_em
)
SELECT
  id,
  CASE UPPER(metodo_pagamento)
    WHEN 'PIX' THEN 'PIX_MP'
    WHEN 'PIX_EXTERNO' THEN 'PIX_EXTERNO'
    WHEN 'CARTAO' THEN 'CARTAO'
    WHEN 'DINHEIRO' THEN 'DINHEIRO'
    ELSE 'A_COMBINAR'
  END,
  CASE WHEN origem_pedido = 'SITE' THEN 'SITE' ELSE 'ADMIN' END,
  valor_total_centavos,
  CASE UPPER(status_pagamento)
    WHEN 'PENDENTE' THEN 'PENDENTE'
    WHEN 'PAGO' THEN 'PAGO'
    WHEN 'CANCELADO' THEN 'CANCELADO'
    WHEN 'EXPIRADO' THEN 'EXPIRADO'
    WHEN 'REEMBOLSADO' THEN 'REEMBOLSADO'
    ELSE 'FALHOU'
  END,
  mp_order_id,
  mp_payment_id,
  mp_status,
  mp_status_detail,
  mp_ticket_url,
  mp_qr_code,
  mp_qr_code_base64,
  idempotency_key,
  criado_em,
  atualizado_em,
  pago_em,
  CASE WHEN UPPER(status_pagamento) = 'CANCELADO' THEN atualizado_em ELSE NULL END
FROM pedidos
WHERE valor_total_centavos > 0;

-- O pagamento legado representava o pedido inteiro. A alocação inicial
-- preserva exatamente essa semântica. O estado visual do item será derivado
-- apenas de alocações cujos pagamentos estejam PAGO.
INSERT INTO pedido_pagamento_alocacoes (pagamento_id, pedido_item_id, valor_centavos)
SELECT pp.id, pi.id, pi.valor_total_centavos
FROM pedido_pagamentos pp
JOIN pedido_itens pi ON pi.pedido_id = pp.pedido_id
WHERE pi.valor_total_centavos > 0;
