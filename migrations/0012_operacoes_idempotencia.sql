-- A1: identidade lógica estável das operações de escrita.
--
-- Migration puramente ADITIVA: nenhuma tabela existente é reconstruída,
-- alterada ou copiada, nenhum histórico é reescrito. As identidades
-- históricas (pedidos.idempotency_key, pedido_pagamentos.idempotency_key,
-- pedido_reembolsos.idempotency_key) continuam valendo exatamente como
-- estão; esta tabela apenas registra a INTENÇÃO que originou cada fato.
--
-- O que ela precisa preservar (e nada além disso — não é framework de
-- jobs, não tem cron/sweep, não é plataforma de workflow):
--   * operation_key ..... identidade criada pelo cliente ANTES do primeiro envio;
--   * tipo/escopo/ator .. a que operação e a quem aquela key pertence;
--   * fingerprint ....... payload canônico versionado, para detectar reutilização
--                         incompatível da MESMA key (conflito estável);
--   * pedido/pagamento/reembolso resultantes .. o que permite replay;
--   * mp_idempotency_key / mp_request / mp_payment_id .. identidade da tentativa
--                         remota, para que a MESMA operação lógica preserve a
--                         MESMA operação externa no Mercado Pago;
--   * fase .............. distingue "operação local criada", "envio remoto
--                         inconclusivo", "recurso remoto conhecido",
--                         "concluída" e "recusada de forma comprovada".
--
-- `operation_key` é UNIQUE global de propósito: uma key identifica UMA
-- operação, e reutilizá-la para outro tipo/escopo/payload é conflito, nunca
-- uma segunda operação silenciosa. Esse UNIQUE é também o claim atômico —
-- o claim e o fato financeiro vivem no MESMO batch (uma transação), então o
-- perdedor da corrida tem o batch inteiro revertido e relê a vencedora.

CREATE TABLE pedido_operacoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  operation_key TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN (
    'CHECKOUT_SITE',
    'PEDIDO_ADMIN',
    'PAGAMENTO_ADMIN',
    'REFUND_ADMIN',
    'PIX_ADMIN',
    'PIX_ADMIN_REGENERACAO'
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
  FOREIGN KEY (ator_usuario_id) REFERENCES usuarios_admin(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX uq_pedido_operacoes_key ON pedido_operacoes(operation_key);
CREATE INDEX idx_pedido_operacoes_pedido ON pedido_operacoes(pedido_id, criado_em);
CREATE INDEX idx_pedido_operacoes_fase ON pedido_operacoes(fase, atualizado_em);
