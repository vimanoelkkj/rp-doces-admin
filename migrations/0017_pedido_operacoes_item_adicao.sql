-- COMANDA VIVA / Fase 3: uma operacao A1 de adicao aponta para o item exato.
--
-- Rebuild necessario porque SQLite nao permite alterar o CHECK de `tipo`.
-- Todos os campos, ids e timestamps existentes sao copiados sem transformacao;
-- operacoes antigas recebem pedido_item_id NULL.

PRAGMA defer_foreign_keys = ON;

CREATE TABLE pedido_operacoes__novo (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  operation_key TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN (
    'CHECKOUT_SITE',
    'PEDIDO_ADMIN',
    'PAGAMENTO_ADMIN',
    'REFUND_ADMIN',
    'PIX_ADMIN',
    'PIX_ADMIN_REGENERACAO',
    'ITEM_ADICAO_ADMIN'
  )),
  escopo TEXT NOT NULL CHECK (escopo IN ('SITE', 'ADMIN')),
  ator_usuario_id INTEGER,
  fingerprint_versao INTEGER NOT NULL,
  fingerprint TEXT NOT NULL,
  fase TEXT NOT NULL DEFAULT 'LOCAL_CRIADA' CHECK (fase IN (
    'LOCAL_CRIADA',
    'ENVIO_INCONCLUSIVO',
    'REMOTO_CONHECIDO',
    'CONCLUIDA',
    'RECUSADA'
  )),
  pedido_id INTEGER,
  pagamento_id INTEGER,
  reembolso_id INTEGER,
  pedido_item_id INTEGER,
  resultado TEXT,
  erro TEXT,
  mp_idempotency_key TEXT,
  mp_request TEXT,
  mp_payment_id TEXT,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE CASCADE,
  FOREIGN KEY (pagamento_id) REFERENCES pedido_pagamentos(id) ON DELETE SET NULL,
  FOREIGN KEY (reembolso_id) REFERENCES pedido_reembolsos(id) ON DELETE SET NULL,
  FOREIGN KEY (pedido_item_id) REFERENCES pedido_itens(id) ON DELETE RESTRICT,
  FOREIGN KEY (ator_usuario_id) REFERENCES usuarios_admin(id) ON DELETE SET NULL
);

INSERT INTO pedido_operacoes__novo (
  id, operation_key, tipo, escopo, ator_usuario_id,
  fingerprint_versao, fingerprint, fase,
  pedido_id, pagamento_id, reembolso_id, pedido_item_id,
  resultado, erro, mp_idempotency_key, mp_request, mp_payment_id,
  criado_em, atualizado_em
)
SELECT
  id, operation_key, tipo, escopo, ator_usuario_id,
  fingerprint_versao, fingerprint, fase,
  pedido_id, pagamento_id, reembolso_id, NULL,
  resultado, erro, mp_idempotency_key, mp_request, mp_payment_id,
  criado_em, atualizado_em
FROM pedido_operacoes;

DROP TABLE pedido_operacoes;
ALTER TABLE pedido_operacoes__novo RENAME TO pedido_operacoes;

CREATE UNIQUE INDEX uq_pedido_operacoes_key
  ON pedido_operacoes(operation_key);
CREATE INDEX idx_pedido_operacoes_pedido
  ON pedido_operacoes(pedido_id, criado_em);
CREATE INDEX idx_pedido_operacoes_fase
  ON pedido_operacoes(fase, atualizado_em);
CREATE INDEX idx_pedido_operacoes_item
  ON pedido_operacoes(pedido_item_id, criado_em);

PRAGMA defer_foreign_keys = OFF;
