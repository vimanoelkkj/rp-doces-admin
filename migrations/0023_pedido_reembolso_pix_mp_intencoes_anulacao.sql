-- Permite reaproveitar o outbox de refund PIX Mercado Pago (0020) para o
-- caso de anulacao (exclusao) de pedido: estornar o saldo restante de um
-- PAGAMENTO inteiro, sem estar amarrado a um cancelamento ou troca de item
-- especifico -- o pedido inteiro esta sendo desfeito, entao nao ha item ao
-- qual atribuir a devolucao.
--
-- Ate aqui a tabela so aceitava exatamente um dos dois pais (cancelamento
-- XOR troca), sempre com uma pagamento_alocacao_id. Esta migration adiciona
-- um TERCEIRO estado valido -- os tres pais nulos -- mantendo os dois
-- estados antigos bit a bit iguais. SQLite nao altera CHECK; e preciso
-- reconstruir a tabela (mesmo padrao das migrations 0016-0019).

-- `pedido_anulacoes_validar_mp` vive em OUTRA tabela (pedido_anulacoes), mas
-- referencia esta no corpo. SQLite reescreve/revalida triggers que citam o
-- nome pelo texto durante o `ALTER TABLE ... RENAME TO` mais abaixo -- sem
-- este DROP, essa revalidacao roda no instante em que a tabela renomeada
-- ainda nao existe sob o nome antigo e o RENAME falha com "no such table".
DROP TRIGGER pedido_anulacoes_validar_mp;
DROP TRIGGER pedido_reembolso_pix_mp_intencoes_validar_insert;
DROP TRIGGER pedido_reembolso_pix_mp_intencoes_identidade_imutavel;
DROP TRIGGER pedido_reembolso_pix_mp_intencoes_validar_confirmacao;
DROP TRIGGER pedido_reembolso_pix_mp_intencoes_anulado_insert;
DROP TRIGGER pedido_reembolso_pix_mp_intencoes_anulado_update;
DROP TRIGGER pedido_reembolso_pix_mp_intencoes_anulado_delete;

CREATE TABLE pedido_reembolso_pix_mp_intencoes__novo (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  operacao_id INTEGER NOT NULL UNIQUE,
  pedido_id INTEGER NOT NULL,
  pagamento_id INTEGER NOT NULL,
  pagamento_alocacao_id INTEGER,
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
  -- Tres estados validos, nunca combinacoes parciais:
  --  (a) cancelamento + alocacao, sem troca;
  --  (b) troca + alocacao, sem cancelamento;
  --  (c) nenhum item pai e nenhuma alocacao -- reembolso do pagamento
  --      inteiro para a anulacao do pedido.
  CHECK (
    (
      pagamento_alocacao_id IS NOT NULL
      AND (
        (pedido_item_cancelamento_id IS NOT NULL AND pedido_item_troca_id IS NULL)
        OR
        (pedido_item_cancelamento_id IS NULL AND pedido_item_troca_id IS NOT NULL)
      )
    )
    OR
    (
      pagamento_alocacao_id IS NULL
      AND pedido_item_cancelamento_id IS NULL
      AND pedido_item_troca_id IS NULL
    )
  ),
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

INSERT INTO pedido_reembolso_pix_mp_intencoes__novo SELECT
  id, operacao_id, pedido_id, pagamento_id, pagamento_alocacao_id,
  pedido_item_cancelamento_id, pedido_item_troca_id, valor_centavos, status,
  mp_payment_id, mp_idempotency_key, mp_request, mp_refund_id, mp_status,
  pedido_reembolso_id, tentativas, ultimo_erro, criado_em, atualizado_em,
  ultima_tentativa_em, confirmado_em, recusado_em
FROM pedido_reembolso_pix_mp_intencoes;

DROP TABLE pedido_reembolso_pix_mp_intencoes;
ALTER TABLE pedido_reembolso_pix_mp_intencoes__novo RENAME TO pedido_reembolso_pix_mp_intencoes;

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
-- Uma unica intencao "sem item" (anulacao) ativa por pagamento. Sozinho isto
-- nao fecha a corrida com intencoes POR ITEM sobre o mesmo pagamento -- essa
-- exclusao mutua e responsabilidade do trigger de validacao abaixo, porque
-- um indice parcial nao enxerga linhas do "outro lado" (uma so tem o item
-- preenchido, a outra so tem ele nulo).
CREATE UNIQUE INDEX uq_pix_mp_refund_pagamento_ativo
  ON pedido_reembolso_pix_mp_intencoes(pagamento_id)
  WHERE pedido_item_cancelamento_id IS NULL AND pedido_item_troca_id IS NULL AND status <> 'RECUSADO';

-- Identico ao original (0020), com um terceiro ramo em OR para o caso "sem
-- item" -- nao exige alocacao nem valida contra cancelamento/troca.
CREATE TRIGGER pedido_reembolso_pix_mp_intencoes_validar_insert
BEFORE INSERT ON pedido_reembolso_pix_mp_intencoes
FOR EACH ROW WHEN NOT EXISTS (
  SELECT 1
  FROM pedido_operacoes o
  JOIN pedido_pagamentos pp ON pp.id = NEW.pagamento_id
  WHERE o.id = NEW.operacao_id AND o.tipo = 'REFUND_ADMIN' AND o.escopo = 'ADMIN'
    AND o.pedido_id = NEW.pedido_id AND o.pagamento_id = NEW.pagamento_id
    AND pp.pedido_id = NEW.pedido_id AND pp.metodo = 'PIX_MP' AND pp.status = 'PAGO'
    AND pp.mp_payment_id = NEW.mp_payment_id
    AND o.mp_idempotency_key = NEW.mp_idempotency_key AND o.mp_request = NEW.mp_request
    AND (
      (NEW.pagamento_alocacao_id IS NOT NULL AND NEW.pedido_item_cancelamento_id IS NOT NULL AND
       EXISTS (SELECT 1 FROM pedido_pagamento_alocacoes a
               JOIN pedido_item_cancelamentos c ON c.id = NEW.pedido_item_cancelamento_id
               WHERE a.id = NEW.pagamento_alocacao_id AND a.pagamento_id = pp.id
                 AND o.pedido_item_cancelamento_id = NEW.pedido_item_cancelamento_id
                 AND c.pedido_id = NEW.pedido_id AND c.pedido_item_id = a.pedido_item_id))
      OR
      (NEW.pagamento_alocacao_id IS NOT NULL AND NEW.pedido_item_troca_id IS NOT NULL AND
       EXISTS (SELECT 1 FROM pedido_pagamento_alocacoes a
               JOIN pedido_item_trocas t ON t.id = NEW.pedido_item_troca_id
               WHERE a.id = NEW.pagamento_alocacao_id AND a.pagamento_id = pp.id
                 AND o.pedido_item_troca_id = NEW.pedido_item_troca_id
                 AND t.pedido_id = NEW.pedido_id AND t.item_origem_id = a.pedido_item_id))
      OR
      (NEW.pagamento_alocacao_id IS NULL AND NEW.pedido_item_cancelamento_id IS NULL
       AND NEW.pedido_item_troca_id IS NULL)
    )
)
BEGIN
  SELECT RAISE(ABORT, 'pix_mp_refund_intencao_inconsistente');
END;

-- Exclusao mutua entre a intencao "sem item" (anulacao) e qualquer intencao
-- POR ITEM sobre o MESMO pagamento: nao podem coexistir ativas (status <>
-- RECUSADO). Fecha a corrida entre "excluir o pedido" e "cancelar/trocar um
-- item" tentando estornar o mesmo dinheiro ao mesmo tempo.
CREATE TRIGGER pedido_reembolso_pix_mp_intencoes_excl_mutua_item_anulacao
BEFORE INSERT ON pedido_reembolso_pix_mp_intencoes
FOR EACH ROW WHEN
  (
    NEW.pedido_item_cancelamento_id IS NULL AND NEW.pedido_item_troca_id IS NULL
    AND EXISTS (
      SELECT 1 FROM pedido_reembolso_pix_mp_intencoes i
      WHERE i.pagamento_id = NEW.pagamento_id AND i.status <> 'RECUSADO'
        AND (i.pedido_item_cancelamento_id IS NOT NULL OR i.pedido_item_troca_id IS NOT NULL)
    )
  )
  OR
  (
    (NEW.pedido_item_cancelamento_id IS NOT NULL OR NEW.pedido_item_troca_id IS NOT NULL)
    AND EXISTS (
      SELECT 1 FROM pedido_reembolso_pix_mp_intencoes i
      WHERE i.pagamento_id = NEW.pagamento_id AND i.status <> 'RECUSADO'
        AND i.pedido_item_cancelamento_id IS NULL AND i.pedido_item_troca_id IS NULL
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'pix_mp_refund_intencao_conflito_item_anulacao');
END;

CREATE TRIGGER pedido_reembolso_pix_mp_intencoes_identidade_imutavel
BEFORE UPDATE OF operacao_id, pedido_id, pagamento_id, pagamento_alocacao_id,
  pedido_item_cancelamento_id, pedido_item_troca_id, valor_centavos,
  mp_payment_id, mp_idempotency_key, mp_request
ON pedido_reembolso_pix_mp_intencoes
FOR EACH ROW WHEN
  NEW.operacao_id <> OLD.operacao_id OR NEW.pedido_id <> OLD.pedido_id
  OR NEW.pagamento_id <> OLD.pagamento_id
  OR NEW.pagamento_alocacao_id IS NOT OLD.pagamento_alocacao_id
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

-- Recriado identico ao da 0022 (ver DROP no topo desta migration).
CREATE TRIGGER pedido_anulacoes_validar_mp
BEFORE INSERT ON pedido_anulacoes
BEGIN
  SELECT RAISE(ABORT,'ANULACAO_MP_RECEBIDO') WHERE EXISTS (
    SELECT 1 FROM pedido_pagamentos pp WHERE pp.pedido_id=NEW.pedido_id
      AND pp.metodo='PIX_MP' AND pp.status='PAGO'
      AND pp.valor_centavos>COALESCE((SELECT SUM(r.valor_centavos) FROM pedido_reembolsos r
        WHERE r.pagamento_id=pp.id AND r.status='REEMBOLSADO'
          AND r.origem='MERCADO_PAGO' AND r.metodo='PIX_MP' AND r.mp_refund_id IS NOT NULL),0)
  );
  -- EXPIRADO local nao prova que o provedor encerrou a cobranca (B3).
  SELECT RAISE(ABORT,'ANULACAO_MP_PENDENTE') WHERE EXISTS (
    SELECT 1 FROM pedido_pagamentos WHERE pedido_id=NEW.pedido_id
      AND metodo='PIX_MP' AND status IN ('PENDENTE','EXPIRADO')
  ) OR EXISTS (
    SELECT 1 FROM pedido_operacoes WHERE pedido_id=NEW.pedido_id
      AND mp_idempotency_key IS NOT NULL AND fase IN ('LOCAL_CRIADA','ENVIO_INCONCLUSIVO')
  );
  SELECT RAISE(ABORT,'ANULACAO_REFUND_PENDENTE') WHERE EXISTS (
    SELECT 1 FROM pedido_reembolso_pix_mp_intencoes WHERE pedido_id=NEW.pedido_id
      AND status IN ('PENDENTE','PROCESSANDO','INCONCLUSIVO')
  ) OR EXISTS (
    SELECT 1 FROM pedido_reembolsos WHERE pedido_id=NEW.pedido_id AND status='PENDENTE'
  );
  SELECT RAISE(ABORT,'ANULACAO_LEGADO_AMBIGUO') WHERE EXISTS (
    SELECT 1 FROM pedidos p WHERE p.id=NEW.pedido_id
      AND (p.status_pagamento IN ('PAGO','PARCIAL') OR p.mp_payment_id IS NOT NULL)
      AND NOT EXISTS(SELECT 1 FROM pedido_pagamentos pp WHERE pp.pedido_id=p.id)
  );
END;

-- Recriados identicos aos da 0022: o rebuild da tabela derruba os triggers
-- que existiam nela.
CREATE TRIGGER pedido_reembolso_pix_mp_intencoes_anulado_insert
BEFORE INSERT ON pedido_reembolso_pix_mp_intencoes
WHEN EXISTS(SELECT 1 FROM pedido_anulacoes WHERE pedido_id=NEW.pedido_id AND efetivada=1)
BEGIN
  SELECT RAISE(ABORT,'PEDIDO_ANULADO');
END;
CREATE TRIGGER pedido_reembolso_pix_mp_intencoes_anulado_update
BEFORE UPDATE ON pedido_reembolso_pix_mp_intencoes
WHEN EXISTS(SELECT 1 FROM pedido_anulacoes WHERE pedido_id=OLD.pedido_id AND efetivada=1) OR EXISTS(SELECT 1 FROM pedido_anulacoes WHERE pedido_id=NEW.pedido_id AND efetivada=1)
BEGIN
  SELECT RAISE(ABORT,'PEDIDO_ANULADO');
END;
CREATE TRIGGER pedido_reembolso_pix_mp_intencoes_anulado_delete
BEFORE DELETE ON pedido_reembolso_pix_mp_intencoes
WHEN EXISTS(SELECT 1 FROM pedido_anulacoes WHERE pedido_id=OLD.pedido_id AND efetivada=1)
BEGIN
  SELECT RAISE(ABORT,'PEDIDO_ANULADO');
END;

PRAGMA foreign_key_check;
