-- COMANDA VIVA / Fase 2: o estado fisico passa a pertencer ao item.
--
-- Esta migration nao movimenta estoque, reserva ou dinheiro. Ela apenas
-- representa, em pedido_itens, o estado que os marcadores historicos ja
-- provam. Os campos globais de pedidos permanecem como projecoes de
-- compatibilidade.

-- Falha antes de qualquer ALTER se algum item controlado nao puder ser
-- classificado ou se a soma que seria classificada como RESERVADO divergir
-- do agregado real de produtos.estoque_reservado. O nome da constraint vira
-- parte do diagnostico do SQLite/D1.
CREATE TABLE _0016_validacao_estado_estoque (
  ok INTEGER NOT NULL,
  CONSTRAINT migration_0016_estado_fisico_ambiguo CHECK (ok = 1)
);

INSERT INTO _0016_validacao_estado_estoque (ok)
WITH candidatos AS (
  SELECT
    pi.id,
    pi.produto_id,
    pi.quantidade,
    CASE
      WHEN pi.produto_id IS NULL THEN 'NAO_APLICAVEL'
      WHEN pi.estoque_baixado_em IS NOT NULL OR p.estoque_baixado_em IS NOT NULL THEN 'BAIXADO'
      WHEN p.reserva_status = 'ATIVA' THEN 'RESERVADO'
      WHEN p.reserva_status = 'LIBERADA' THEN 'LIBERADO'
      WHEN p.reserva_status = 'SEM_RESERVA' THEN 'SEM_RESERVA'
      ELSE NULL
    END AS estado
  FROM pedido_itens pi
  JOIN pedidos p ON p.id = pi.pedido_id
), reservados_esperados AS (
  SELECT produto_id, SUM(quantidade) AS quantidade
  FROM candidatos
  WHERE estado = 'RESERVADO'
  GROUP BY produto_id
)
SELECT CASE
  WHEN EXISTS (SELECT 1 FROM candidatos WHERE estado IS NULL) THEN 0
  WHEN EXISTS (
    SELECT 1
    FROM produtos pr
    LEFT JOIN reservados_esperados re ON re.produto_id = pr.id
    WHERE pr.estoque_reservado <> COALESCE(re.quantidade, 0)
  ) THEN 0
  ELSE 1
END;

DROP TABLE _0016_validacao_estado_estoque;

ALTER TABLE pedido_itens ADD COLUMN status_item TEXT NOT NULL DEFAULT 'ATIVO'
  CHECK (status_item IN ('ATIVO', 'CANCELADO'));

-- NULL existe apenas durante esta migration. Os triggers criados depois do
-- backfill tornam NULL invalido para INSERT e UPDATE futuros sem depender de
-- um default que esconderia a origem da reserva.
ALTER TABLE pedido_itens ADD COLUMN estoque_estado TEXT
  CHECK (estoque_estado IS NULL OR estoque_estado IN (
    'NAO_APLICAVEL',
    'SEM_RESERVA',
    'RESERVADO',
    'LIBERADO',
    'BAIXADO',
    'REPOSTO'
  ));
ALTER TABLE pedido_itens ADD COLUMN estoque_reservado_em TEXT;
ALTER TABLE pedido_itens ADD COLUMN estoque_liberado_em TEXT;
ALTER TABLE pedido_itens ADD COLUMN estoque_reposto_em TEXT;

UPDATE pedido_itens AS pi
SET estoque_estado = CASE
      WHEN pi.produto_id IS NULL THEN 'NAO_APLICAVEL'
      WHEN pi.estoque_baixado_em IS NOT NULL
        OR (SELECT p.estoque_baixado_em FROM pedidos p WHERE p.id = pi.pedido_id) IS NOT NULL
        THEN 'BAIXADO'
      WHEN (SELECT p.reserva_status FROM pedidos p WHERE p.id = pi.pedido_id) = 'ATIVA'
        THEN 'RESERVADO'
      WHEN (SELECT p.reserva_status FROM pedidos p WHERE p.id = pi.pedido_id) = 'LIBERADA'
        THEN 'LIBERADO'
      ELSE 'SEM_RESERVA'
    END,
    estoque_baixado_em = COALESCE(
      pi.estoque_baixado_em,
      CASE WHEN pi.produto_id IS NOT NULL THEN
        (SELECT p.estoque_baixado_em FROM pedidos p WHERE p.id = pi.pedido_id)
      END
    ),
    estoque_liberado_em = CASE
      WHEN pi.produto_id IS NOT NULL
       AND (SELECT p.reserva_status FROM pedidos p WHERE p.id = pi.pedido_id) = 'LIBERADA'
      THEN (SELECT p.reserva_liberada_em FROM pedidos p WHERE p.id = pi.pedido_id)
      ELSE NULL
    END;

CREATE INDEX idx_pedido_itens_estado_estoque
  ON pedido_itens(pedido_id, status_item, estoque_estado, id);

CREATE TRIGGER pedido_itens_exigir_estoque_estado_insert
BEFORE INSERT ON pedido_itens
FOR EACH ROW
WHEN NEW.estoque_estado IS NULL
BEGIN
  SELECT RAISE(ABORT, 'pedido_itens.estoque_estado obrigatorio');
END;

CREATE TRIGGER pedido_itens_exigir_estoque_estado_update
BEFORE UPDATE OF estoque_estado ON pedido_itens
FOR EACH ROW
WHEN NEW.estoque_estado IS NULL
BEGIN
  SELECT RAISE(ABORT, 'pedido_itens.estoque_estado obrigatorio');
END;

-- Compatibilidade estrita com o fluxo atual de Pix ADMIN: ao readquirir uma
-- reserva LIBERADA/SEM_RESERVA, comandaPix incrementa o agregado do produto,
-- muda o pedido para ATIVA e insere a nova tentativa no mesmo batch. O trigger
-- usa essa tentativa como prova final da readquisicao. Ele fica no INSERT para
-- nao alterar o changes do UPDATE de pedidos, usado por comandaPix para saber
-- se a operacao e dona da reserva e deve compensa-la em caso de recusa.
CREATE TRIGGER pedido_pagamentos_reativar_reserva_por_item
AFTER INSERT ON pedido_pagamentos
FOR EACH ROW
WHEN NEW.metodo = 'PIX_MP'
 AND NEW.origem = 'ADMIN'
 AND NEW.status = 'PENDENTE'
 AND (SELECT p.reserva_status FROM pedidos p WHERE p.id = NEW.pedido_id) = 'ATIVA'
BEGIN
  UPDATE pedido_itens
  SET estoque_estado = 'RESERVADO',
      estoque_reservado_em = CURRENT_TIMESTAMP
  WHERE pedido_id = NEW.pedido_id
    AND status_item = 'ATIVO'
    AND produto_id IS NOT NULL
    AND estoque_estado IN ('SEM_RESERVA', 'LIBERADO')
    AND (SELECT pr.estoque_reservado FROM produtos pr
         WHERE pr.id = pedido_itens.produto_id) >=
        COALESCE((SELECT SUM(res.quantidade) FROM pedido_itens res
                  WHERE res.produto_id = pedido_itens.produto_id
                    AND res.status_item = 'ATIVO'
                    AND res.estoque_estado = 'RESERVADO'), 0)
        +
        COALESCE((SELECT SUM(pend.quantidade) FROM pedido_itens pend
                  WHERE pend.pedido_id = NEW.pedido_id
                    AND pend.produto_id = pedido_itens.produto_id
                    AND pend.status_item = 'ATIVO'
                    AND pend.estoque_estado IN ('SEM_RESERVA', 'LIBERADO')), 0);
END;
