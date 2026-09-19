-- Outbox recuperavel para refunds parciais PIX Mercado Pago.
-- A intencao existe antes da rede; pedido_reembolsos continua contendo
-- somente o fato financeiro confirmado pelo provedor.

CREATE TABLE pedido_reembolso_pix_mp_intencoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  operacao_id INTEGER NOT NULL UNIQUE,
  pedido_id INTEGER NOT NULL,
  pagamento_id INTEGER NOT NULL,
  pagamento_alocacao_id INTEGER NOT NULL,
  pedido_item_cancelamento_id INTEGER,
  pedido_item_troca_id INTEGER,
  valor_centavos INTEGER NOT NULL CHECK (valor_centavos > 0),
  status TEXT NOT NULL DEFAULT 'PENDENTE' CHECK (status IN (
    'PENDENTE', 'PROCESSANDO', 'CONFIRMADO', 'RECUSADO', 'INCONCLUSIVO'
  )),
  mp_payment_id TEXT NOT NULL,
  mp_idempotency_key TEXT NOT NULL UNIQUE,
  mp_request TEXT NOT NULL,
  mp_refund_id TEXT UNIQUE,
  mp_status TEXT,
  pedido_reembolso_id INTEGER UNIQUE,
  tentativas INTEGER NOT NULL DEFAULT 0 CHECK (tentativas >= 0),
  ultimo_erro TEXT,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ultima_tentativa_em TEXT,
  confirmado_em TEXT,
  recusado_em TEXT,
  CHECK ((pedido_item_cancelamento_id IS NOT NULL) <> (pedido_item_troca_id IS NOT NULL)),
  CHECK (status <> 'CONFIRMADO' OR (
    mp_refund_id IS NOT NULL AND pedido_reembolso_id IS NOT NULL AND confirmado_em IS NOT NULL
  )),
  CHECK (status = 'CONFIRMADO' OR pedido_reembolso_id IS NULL),
  CHECK (status <> 'RECUSADO' OR recusado_em IS NOT NULL),
  FOREIGN KEY (operacao_id) REFERENCES pedido_operacoes(id) ON DELETE RESTRICT,
  FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE RESTRICT,
  FOREIGN KEY (pagamento_id) REFERENCES pedido_pagamentos(id) ON DELETE RESTRICT,
  FOREIGN KEY (pagamento_alocacao_id) REFERENCES pedido_pagamento_alocacoes(id) ON DELETE RESTRICT,
  FOREIGN KEY (pedido_item_cancelamento_id) REFERENCES pedido_item_cancelamentos(id) ON DELETE RESTRICT,
  FOREIGN KEY (pedido_item_troca_id) REFERENCES pedido_item_trocas(id) ON DELETE RESTRICT,
  FOREIGN KEY (pedido_reembolso_id) REFERENCES pedido_reembolsos(id) ON DELETE RESTRICT
);

CREATE INDEX idx_pix_mp_refund_intencoes_status
  ON pedido_reembolso_pix_mp_intencoes(status, atualizado_em);
CREATE INDEX idx_pix_mp_refund_intencoes_pedido
  ON pedido_reembolso_pix_mp_intencoes(pedido_id, criado_em);
CREATE INDEX idx_pix_mp_refund_intencoes_alocacao
  ON pedido_reembolso_pix_mp_intencoes(pagamento_alocacao_id, status);
CREATE UNIQUE INDEX uq_pix_mp_refund_cancelamento_ativo
  ON pedido_reembolso_pix_mp_intencoes(pedido_item_cancelamento_id, pagamento_alocacao_id)
  WHERE pedido_item_cancelamento_id IS NOT NULL AND status <> 'RECUSADO';
CREATE UNIQUE INDEX uq_pix_mp_refund_troca_ativo
  ON pedido_reembolso_pix_mp_intencoes(pedido_item_troca_id, pagamento_alocacao_id)
  WHERE pedido_item_troca_id IS NOT NULL AND status <> 'RECUSADO';
CREATE UNIQUE INDEX uq_pedido_reembolsos_mp_refund_id
  ON pedido_reembolsos(mp_refund_id) WHERE mp_refund_id IS NOT NULL;

CREATE TRIGGER pedido_reembolso_pix_mp_intencoes_validar_insert
BEFORE INSERT ON pedido_reembolso_pix_mp_intencoes
FOR EACH ROW WHEN NOT EXISTS (
  SELECT 1
  FROM pedido_operacoes o
  JOIN pedido_pagamentos pp ON pp.id = NEW.pagamento_id
  JOIN pedido_pagamento_alocacoes a ON a.id = NEW.pagamento_alocacao_id
  WHERE o.id = NEW.operacao_id AND o.tipo = 'REFUND_ADMIN' AND o.escopo = 'ADMIN'
    AND o.pedido_id = NEW.pedido_id AND o.pagamento_id = NEW.pagamento_id
    AND pp.pedido_id = NEW.pedido_id AND pp.metodo = 'PIX_MP' AND pp.status = 'PAGO'
    AND a.pagamento_id = pp.id AND pp.mp_payment_id = NEW.mp_payment_id
    AND o.mp_idempotency_key = NEW.mp_idempotency_key AND o.mp_request = NEW.mp_request
    AND (
      (NEW.pedido_item_cancelamento_id IS NOT NULL AND
       o.pedido_item_cancelamento_id = NEW.pedido_item_cancelamento_id AND
       EXISTS (SELECT 1 FROM pedido_item_cancelamentos c
               WHERE c.id = NEW.pedido_item_cancelamento_id
                 AND c.pedido_id = NEW.pedido_id AND c.pedido_item_id = a.pedido_item_id))
      OR
      (NEW.pedido_item_troca_id IS NOT NULL AND
       o.pedido_item_troca_id = NEW.pedido_item_troca_id AND
       EXISTS (SELECT 1 FROM pedido_item_trocas t
               WHERE t.id = NEW.pedido_item_troca_id
                 AND t.pedido_id = NEW.pedido_id AND t.item_origem_id = a.pedido_item_id))
    )
)
BEGIN
  SELECT RAISE(ABORT, 'pix_mp_refund_intencao_inconsistente');
END;

CREATE TRIGGER pedido_reembolso_pix_mp_intencoes_identidade_imutavel
BEFORE UPDATE OF operacao_id, pedido_id, pagamento_id, pagamento_alocacao_id,
  pedido_item_cancelamento_id, pedido_item_troca_id, valor_centavos,
  mp_payment_id, mp_idempotency_key, mp_request
ON pedido_reembolso_pix_mp_intencoes
FOR EACH ROW WHEN
  NEW.operacao_id <> OLD.operacao_id OR NEW.pedido_id <> OLD.pedido_id
  OR NEW.pagamento_id <> OLD.pagamento_id
  OR NEW.pagamento_alocacao_id <> OLD.pagamento_alocacao_id
  OR NEW.pedido_item_cancelamento_id IS NOT OLD.pedido_item_cancelamento_id
  OR NEW.pedido_item_troca_id IS NOT OLD.pedido_item_troca_id
  OR NEW.valor_centavos <> OLD.valor_centavos
  OR NEW.mp_payment_id <> OLD.mp_payment_id
  OR NEW.mp_idempotency_key <> OLD.mp_idempotency_key
  OR NEW.mp_request <> OLD.mp_request
BEGIN
  SELECT RAISE(ABORT, 'pix_mp_refund_identidade_imutavel');
END;

CREATE TRIGGER pedido_reembolso_pix_mp_intencoes_validar_confirmacao
BEFORE UPDATE OF status, mp_refund_id, pedido_reembolso_id
ON pedido_reembolso_pix_mp_intencoes
FOR EACH ROW WHEN NEW.status = 'CONFIRMADO' AND NOT EXISTS (
  SELECT 1 FROM pedido_reembolsos r
  WHERE r.id = NEW.pedido_reembolso_id AND r.pedido_id = NEW.pedido_id
    AND r.pagamento_id = NEW.pagamento_id AND r.origem = 'MERCADO_PAGO'
    AND r.metodo = 'PIX_MP' AND r.status = 'REEMBOLSADO'
    AND r.valor_centavos = NEW.valor_centavos
    AND r.mp_refund_id = NEW.mp_refund_id
)
BEGIN
  SELECT RAISE(ABORT, 'pix_mp_refund_confirmacao_inconsistente');
END;
