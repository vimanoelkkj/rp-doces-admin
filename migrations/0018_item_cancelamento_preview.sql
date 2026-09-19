-- COMANDA VIVA / Fase 5: modelo auditavel de cancelamento por item e
-- atribuicao explicita de refunds as alocacoes financeiras originais.
--
-- Esta migration nao cria cancelamentos nem movimenta dinheiro/estoque.
-- As duas tabelas novas nascem vazias. A unica reconstrucao e a de
-- pedido_operacoes, necessaria para ampliar seu CHECK de tipo e guardar a
-- referencia A1 do futuro POST de cancelamento. A copia e integral e 1:1.

CREATE TABLE pedido_item_cancelamentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pedido_id INTEGER NOT NULL,
  pedido_item_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'SOLICITADO' CHECK (status IN (
    'SOLICITADO',
    'AGUARDANDO_REEMBOLSO',
    'INCONCLUSIVO',
    'CONCLUIDO',
    'FALHOU'
  )),
  valor_item_centavos INTEGER NOT NULL CHECK (valor_item_centavos >= 0),
  valor_pago_associado_centavos INTEGER NOT NULL
    CHECK (valor_pago_associado_centavos >= 0),
  valor_reembolso_necessario_centavos INTEGER NOT NULL
    CHECK (valor_reembolso_necessario_centavos >= 0),
  estoque_acao TEXT NOT NULL CHECK (estoque_acao IN (
    'LIBERAR_RESERVA',
    'NAO_REPOR',
    'NENHUMA',
    'REPOR'
  )),
  motivo TEXT NOT NULL DEFAULT '',
  registrado_por_usuario_id INTEGER,
  snapshot_financeiro TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  concluido_em TEXT,
  FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE RESTRICT,
  FOREIGN KEY (pedido_item_id) REFERENCES pedido_itens(id) ON DELETE RESTRICT,
  FOREIGN KEY (registrado_por_usuario_id) REFERENCES usuarios_admin(id) ON DELETE SET NULL
);

CREATE INDEX idx_pedido_item_cancelamentos_pedido
  ON pedido_item_cancelamentos(pedido_id, criado_em);
CREATE INDEX idx_pedido_item_cancelamentos_item
  ON pedido_item_cancelamentos(pedido_item_id, criado_em);
-- FALHOU e a unica situacao em que uma nova intencao pode substituir a
-- anterior. Todos os demais estados representam uma decisao ainda ativa ou
-- historicamente concluida para aquele item.
CREATE UNIQUE INDEX uq_pedido_item_cancelamentos_efetivo
  ON pedido_item_cancelamentos(pedido_item_id)
  WHERE status <> 'FALHOU';

CREATE TRIGGER pedido_item_cancelamentos_validar_pedido_insert
BEFORE INSERT ON pedido_item_cancelamentos
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM pedido_itens pi
  WHERE pi.id = NEW.pedido_item_id AND pi.pedido_id = NEW.pedido_id
)
BEGIN
  SELECT RAISE(ABORT, 'cancelamento_item_fora_do_pedido');
END;

CREATE TRIGGER pedido_item_cancelamentos_validar_pedido_update
BEFORE UPDATE OF pedido_id, pedido_item_id ON pedido_item_cancelamentos
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM pedido_itens pi
  WHERE pi.id = NEW.pedido_item_id AND pi.pedido_id = NEW.pedido_id
)
BEGIN
  SELECT RAISE(ABORT, 'cancelamento_item_fora_do_pedido');
END;

CREATE TABLE pedido_reembolso_alocacoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reembolso_id INTEGER NOT NULL,
  pagamento_alocacao_id INTEGER NOT NULL,
  pedido_item_cancelamento_id INTEGER NOT NULL,
  valor_centavos INTEGER NOT NULL CHECK (valor_centavos > 0),
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (reembolso_id) REFERENCES pedido_reembolsos(id) ON DELETE RESTRICT,
  FOREIGN KEY (pagamento_alocacao_id) REFERENCES pedido_pagamento_alocacoes(id) ON DELETE RESTRICT,
  FOREIGN KEY (pedido_item_cancelamento_id) REFERENCES pedido_item_cancelamentos(id) ON DELETE RESTRICT,
  UNIQUE (reembolso_id, pagamento_alocacao_id)
);

CREATE INDEX idx_pedido_reembolso_alocacoes_reembolso
  ON pedido_reembolso_alocacoes(reembolso_id);
CREATE INDEX idx_pedido_reembolso_alocacoes_pagamento_alocacao
  ON pedido_reembolso_alocacoes(pagamento_alocacao_id);
CREATE INDEX idx_pedido_reembolso_alocacoes_cancelamento
  ON pedido_reembolso_alocacoes(pedido_item_cancelamento_id);

-- A consistencia cruza quatro entidades e, portanto, nao cabe num CHECK do
-- SQLite. Os triggers abaixo a aplicam no banco: refund e alocacao precisam
-- pertencer ao mesmo pagamento; a alocacao precisa ser do item cancelado;
-- todos precisam pertencer ao mesmo pedido; e nenhum dos dois fatos pode ser
-- sobrealocado.
CREATE TRIGGER pedido_reembolso_alocacoes_validar_insert
BEFORE INSERT ON pedido_reembolso_alocacoes
FOR EACH ROW
WHEN
  NOT EXISTS (
    SELECT 1
    FROM pedido_reembolsos r
    JOIN pedido_pagamento_alocacoes a ON a.id = NEW.pagamento_alocacao_id
    JOIN pedido_pagamentos pp ON pp.id = a.pagamento_id
    JOIN pedido_itens pi ON pi.id = a.pedido_item_id
    JOIN pedido_item_cancelamentos c ON c.id = NEW.pedido_item_cancelamento_id
    WHERE r.id = NEW.reembolso_id
      AND r.pagamento_id = a.pagamento_id
      AND r.pedido_id = pp.pedido_id
      AND r.pedido_id = pi.pedido_id
      AND r.pedido_id = c.pedido_id
      AND a.pedido_item_id = c.pedido_item_id
  )
  OR NEW.valor_centavos + COALESCE((
    SELECT SUM(ra.valor_centavos)
    FROM pedido_reembolso_alocacoes ra
    WHERE ra.pagamento_alocacao_id = NEW.pagamento_alocacao_id
  ), 0) > (
    SELECT a.valor_centavos FROM pedido_pagamento_alocacoes a
    WHERE a.id = NEW.pagamento_alocacao_id
  )
  OR NEW.valor_centavos + COALESCE((
    SELECT SUM(ra.valor_centavos)
    FROM pedido_reembolso_alocacoes ra
    WHERE ra.reembolso_id = NEW.reembolso_id
  ), 0) > (
    SELECT r.valor_centavos FROM pedido_reembolsos r
    WHERE r.id = NEW.reembolso_id
  )
BEGIN
  SELECT RAISE(ABORT, 'reembolso_alocacao_inconsistente');
END;

CREATE TRIGGER pedido_reembolso_alocacoes_validar_update
BEFORE UPDATE OF reembolso_id, pagamento_alocacao_id,
  pedido_item_cancelamento_id, valor_centavos ON pedido_reembolso_alocacoes
FOR EACH ROW
WHEN
  NOT EXISTS (
    SELECT 1
    FROM pedido_reembolsos r
    JOIN pedido_pagamento_alocacoes a ON a.id = NEW.pagamento_alocacao_id
    JOIN pedido_pagamentos pp ON pp.id = a.pagamento_id
    JOIN pedido_itens pi ON pi.id = a.pedido_item_id
    JOIN pedido_item_cancelamentos c ON c.id = NEW.pedido_item_cancelamento_id
    WHERE r.id = NEW.reembolso_id
      AND r.pagamento_id = a.pagamento_id
      AND r.pedido_id = pp.pedido_id
      AND r.pedido_id = pi.pedido_id
      AND r.pedido_id = c.pedido_id
      AND a.pedido_item_id = c.pedido_item_id
  )
  OR NEW.valor_centavos + COALESCE((
    SELECT SUM(ra.valor_centavos)
    FROM pedido_reembolso_alocacoes ra
    WHERE ra.pagamento_alocacao_id = NEW.pagamento_alocacao_id
      AND ra.id <> OLD.id
  ), 0) > (
    SELECT a.valor_centavos FROM pedido_pagamento_alocacoes a
    WHERE a.id = NEW.pagamento_alocacao_id
  )
  OR NEW.valor_centavos + COALESCE((
    SELECT SUM(ra.valor_centavos)
    FROM pedido_reembolso_alocacoes ra
    WHERE ra.reembolso_id = NEW.reembolso_id AND ra.id <> OLD.id
  ), 0) > (
    SELECT r.valor_centavos FROM pedido_reembolsos r
    WHERE r.id = NEW.reembolso_id
  )
BEGIN
  SELECT RAISE(ABORT, 'reembolso_alocacao_inconsistente');
END;

-- Impede que uma alteracao posterior nos pais invalide ligacoes existentes.
CREATE TRIGGER pedido_reembolsos_preservar_alocacoes_update
BEFORE UPDATE OF pedido_id, pagamento_id, valor_centavos ON pedido_reembolsos
FOR EACH ROW
WHEN EXISTS (
  SELECT 1
  FROM pedido_reembolso_alocacoes ra
  JOIN pedido_pagamento_alocacoes a ON a.id = ra.pagamento_alocacao_id
  JOIN pedido_item_cancelamentos c ON c.id = ra.pedido_item_cancelamento_id
  WHERE ra.reembolso_id = OLD.id
    AND (
      NEW.pagamento_id <> a.pagamento_id
      OR NEW.pedido_id <> c.pedido_id
      OR NEW.valor_centavos < (
        SELECT COALESCE(SUM(ra2.valor_centavos), 0)
        FROM pedido_reembolso_alocacoes ra2
        WHERE ra2.reembolso_id = OLD.id
      )
    )
)
BEGIN
  SELECT RAISE(ABORT, 'reembolso_alocacao_inconsistente');
END;

CREATE TRIGGER pedido_pagamento_alocacoes_preservar_reembolsos_update
BEFORE UPDATE OF pagamento_id, pedido_item_id, valor_centavos ON pedido_pagamento_alocacoes
FOR EACH ROW
WHEN EXISTS (
  SELECT 1
  FROM pedido_reembolso_alocacoes ra
  JOIN pedido_reembolsos r ON r.id = ra.reembolso_id
  JOIN pedido_item_cancelamentos c ON c.id = ra.pedido_item_cancelamento_id
  WHERE ra.pagamento_alocacao_id = OLD.id
    AND (
      NEW.pagamento_id <> r.pagamento_id
      OR NEW.pedido_item_id <> c.pedido_item_id
      OR NEW.valor_centavos < (
        SELECT COALESCE(SUM(ra2.valor_centavos), 0)
        FROM pedido_reembolso_alocacoes ra2
        WHERE ra2.pagamento_alocacao_id = OLD.id
      )
    )
)
BEGIN
  SELECT RAISE(ABORT, 'reembolso_alocacao_inconsistente');
END;

CREATE TRIGGER pedido_item_cancelamentos_preservar_reembolsos_update
BEFORE UPDATE OF pedido_id, pedido_item_id ON pedido_item_cancelamentos
FOR EACH ROW
WHEN EXISTS (
  SELECT 1
  FROM pedido_reembolso_alocacoes ra
  JOIN pedido_pagamento_alocacoes a ON a.id = ra.pagamento_alocacao_id
  JOIN pedido_itens pi ON pi.id = a.pedido_item_id
  JOIN pedido_reembolsos r ON r.id = ra.reembolso_id
  WHERE ra.pedido_item_cancelamento_id = OLD.id
    AND (NEW.pedido_item_id <> a.pedido_item_id OR NEW.pedido_id <> r.pedido_id
      OR NEW.pedido_id <> pi.pedido_id)
)
BEGIN
  SELECT RAISE(ABORT, 'reembolso_alocacao_inconsistente');
END;

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
    'ITEM_ADICAO_ADMIN',
    'ITEM_CANCELAMENTO_ADMIN'
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
  pedido_item_cancelamento_id INTEGER,
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
  FOREIGN KEY (pedido_item_cancelamento_id) REFERENCES pedido_item_cancelamentos(id) ON DELETE RESTRICT,
  FOREIGN KEY (ator_usuario_id) REFERENCES usuarios_admin(id) ON DELETE SET NULL
);

INSERT INTO pedido_operacoes__novo (
  id, operation_key, tipo, escopo, ator_usuario_id,
  fingerprint_versao, fingerprint, fase,
  pedido_id, pagamento_id, reembolso_id, pedido_item_id,
  pedido_item_cancelamento_id,
  resultado, erro, mp_idempotency_key, mp_request, mp_payment_id,
  criado_em, atualizado_em
)
SELECT
  id, operation_key, tipo, escopo, ator_usuario_id,
  fingerprint_versao, fingerprint, fase,
  pedido_id, pagamento_id, reembolso_id, pedido_item_id,
  NULL,
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
CREATE INDEX idx_pedido_operacoes_item_cancelamento
  ON pedido_operacoes(pedido_item_cancelamento_id, criado_em);

PRAGMA defer_foreign_keys = OFF;
