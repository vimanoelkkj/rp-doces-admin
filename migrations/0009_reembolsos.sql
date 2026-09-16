-- Passo 5: ledger de reembolsos. Nunca muta pedido_pagamentos (nem
-- valor_centavos, nem status) — o pagamento original permanece um fato
-- histórico intacto ("R$100 entraram"), e pedido_reembolsos registra os
-- eventos de saída ("R$30 saíram depois"). O líquido é sempre calculado,
-- nunca gravado sobre o evento original.
--
-- Sem o índice único `pagamento_id WHERE status='REEMBOLSADO'` que
-- produção criou na migration 030 e removeu na 036 — já nascemos
-- suportando múltiplos reembolsos parciais por pagamento.

CREATE TABLE pedido_reembolsos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pedido_id INTEGER NOT NULL,
  pagamento_id INTEGER NOT NULL,
  origem TEXT NOT NULL CHECK (origem IN ('MERCADO_PAGO', 'MANUAL')),
  metodo TEXT NOT NULL CHECK (metodo IN ('PIX_MP', 'PIX_EXTERNO', 'CARTAO', 'DINHEIRO', 'OUTRO')),
  valor_centavos INTEGER NOT NULL CHECK (valor_centavos > 0),
  status TEXT NOT NULL DEFAULT 'PENDENTE'
    CHECK (status IN ('PENDENTE', 'REEMBOLSADO', 'FALHOU')),
  mp_refund_id TEXT,
  mp_status TEXT,
  idempotency_key TEXT NOT NULL,
  registrado_por_usuario_id INTEGER,
  motivo TEXT NOT NULL DEFAULT '',
  devolveu_estoque INTEGER NOT NULL DEFAULT 0 CHECK (devolveu_estoque IN (0, 1)),
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  concluido_em TEXT,
  FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE CASCADE,
  FOREIGN KEY (pagamento_id) REFERENCES pedido_pagamentos(id) ON DELETE CASCADE,
  FOREIGN KEY (registrado_por_usuario_id) REFERENCES usuarios_admin(id) ON DELETE SET NULL
);

CREATE INDEX idx_pedido_reembolsos_pedido ON pedido_reembolsos(pedido_id, status, criado_em);
CREATE INDEX idx_pedido_reembolsos_pagamento ON pedido_reembolsos(pagamento_id, status);
CREATE UNIQUE INDEX uq_pedido_reembolsos_idempotency ON pedido_reembolsos(idempotency_key);
