-- Cobertura financeira de destinos de troca e derivada da cadeia historica.
-- Nenhuma alocacao e movida ou duplicada.

DROP TRIGGER IF EXISTS pedido_reembolso_alocacoes_validar_insert;
DROP TRIGGER IF EXISTS pedido_reembolso_alocacoes_validar_update;
DROP TRIGGER IF EXISTS pedido_item_troca_reembolsos_validar_insert;
DROP TRIGGER IF EXISTS pedido_item_troca_reembolsos_validar_update;
DROP TRIGGER IF EXISTS pedido_pagamento_alocacoes_preservar_reembolsos_update;
DROP TRIGGER IF EXISTS pedido_item_cancelamentos_preservar_reembolsos_update;
DROP TRIGGER IF EXISTS pedido_item_trocas_preservar_reembolsos_update;

CREATE TRIGGER pedido_reembolso_alocacoes_validar_insert
BEFORE INSERT ON pedido_reembolso_alocacoes
FOR EACH ROW WHEN
  NOT EXISTS (
    WITH RECURSIVE linhagem(item_id) AS (
      SELECT pedido_item_id FROM pedido_item_cancelamentos
      WHERE id=NEW.pedido_item_cancelamento_id
      UNION
      SELECT t.item_origem_id FROM pedido_item_trocas t
      JOIN linhagem l ON l.item_id=t.item_destino_id
      WHERE t.status IN ('CONCLUIDA','AGUARDANDO_COBRANCA')
    )
    SELECT 1 FROM pedido_reembolsos r
    JOIN pedido_pagamento_alocacoes a ON a.id=NEW.pagamento_alocacao_id
    JOIN pedido_pagamentos pp ON pp.id=a.pagamento_id
    JOIN pedido_item_cancelamentos c ON c.id=NEW.pedido_item_cancelamento_id
    WHERE r.id=NEW.reembolso_id AND r.pagamento_id=a.pagamento_id
      AND r.pedido_id=pp.pedido_id AND r.pedido_id=c.pedido_id
      AND a.pedido_item_id IN (SELECT item_id FROM linhagem)
  )
  OR NEW.valor_centavos + COALESCE((
    SELECT SUM(valor_centavos) FROM (
      SELECT valor_centavos FROM pedido_reembolso_alocacoes
      WHERE pagamento_alocacao_id=NEW.pagamento_alocacao_id
      UNION ALL
      SELECT valor_centavos FROM pedido_item_troca_reembolso_alocacoes
      WHERE pagamento_alocacao_id=NEW.pagamento_alocacao_id
    )
  ),0) > (SELECT valor_centavos FROM pedido_pagamento_alocacoes WHERE id=NEW.pagamento_alocacao_id)
  OR NEW.valor_centavos + COALESCE((
    SELECT SUM(valor_centavos) FROM (
      SELECT valor_centavos FROM pedido_reembolso_alocacoes WHERE reembolso_id=NEW.reembolso_id
      UNION ALL
      SELECT valor_centavos FROM pedido_item_troca_reembolso_alocacoes WHERE reembolso_id=NEW.reembolso_id
    )
  ),0) > (SELECT valor_centavos FROM pedido_reembolsos WHERE id=NEW.reembolso_id)
BEGIN
  SELECT RAISE(ABORT,'reembolso_alocacao_inconsistente');
END;

CREATE TRIGGER pedido_reembolso_alocacoes_validar_update
BEFORE UPDATE OF reembolso_id,pagamento_alocacao_id,pedido_item_cancelamento_id,valor_centavos
ON pedido_reembolso_alocacoes
FOR EACH ROW WHEN
  NOT EXISTS (
    WITH RECURSIVE linhagem(item_id) AS (
      SELECT pedido_item_id FROM pedido_item_cancelamentos
      WHERE id=NEW.pedido_item_cancelamento_id
      UNION
      SELECT t.item_origem_id FROM pedido_item_trocas t
      JOIN linhagem l ON l.item_id=t.item_destino_id
      WHERE t.status IN ('CONCLUIDA','AGUARDANDO_COBRANCA')
    )
    SELECT 1 FROM pedido_reembolsos r
    JOIN pedido_pagamento_alocacoes a ON a.id=NEW.pagamento_alocacao_id
    JOIN pedido_pagamentos pp ON pp.id=a.pagamento_id
    JOIN pedido_item_cancelamentos c ON c.id=NEW.pedido_item_cancelamento_id
    WHERE r.id=NEW.reembolso_id AND r.pagamento_id=a.pagamento_id
      AND r.pedido_id=pp.pedido_id AND r.pedido_id=c.pedido_id
      AND a.pedido_item_id IN (SELECT item_id FROM linhagem)
  )
  OR NEW.valor_centavos
     + COALESCE((SELECT SUM(valor_centavos) FROM pedido_reembolso_alocacoes
                 WHERE pagamento_alocacao_id=NEW.pagamento_alocacao_id AND id<>OLD.id),0)
     + COALESCE((SELECT SUM(valor_centavos) FROM pedido_item_troca_reembolso_alocacoes
                 WHERE pagamento_alocacao_id=NEW.pagamento_alocacao_id),0)
     > (SELECT valor_centavos FROM pedido_pagamento_alocacoes WHERE id=NEW.pagamento_alocacao_id)
  OR NEW.valor_centavos
     + COALESCE((SELECT SUM(valor_centavos) FROM pedido_reembolso_alocacoes
                 WHERE reembolso_id=NEW.reembolso_id AND id<>OLD.id),0)
     + COALESCE((SELECT SUM(valor_centavos) FROM pedido_item_troca_reembolso_alocacoes
                 WHERE reembolso_id=NEW.reembolso_id),0)
     > (SELECT valor_centavos FROM pedido_reembolsos WHERE id=NEW.reembolso_id)
BEGIN
  SELECT RAISE(ABORT,'reembolso_alocacao_inconsistente');
END;

CREATE TRIGGER pedido_item_troca_reembolsos_validar_insert
BEFORE INSERT ON pedido_item_troca_reembolso_alocacoes
FOR EACH ROW WHEN
  NOT EXISTS (
    WITH RECURSIVE linhagem(item_id) AS (
      SELECT item_origem_id FROM pedido_item_trocas WHERE id=NEW.pedido_item_troca_id
      UNION
      SELECT t.item_origem_id FROM pedido_item_trocas t
      JOIN linhagem l ON l.item_id=t.item_destino_id
      WHERE t.status IN ('CONCLUIDA','AGUARDANDO_COBRANCA')
    )
    SELECT 1 FROM pedido_reembolsos r
    JOIN pedido_pagamento_alocacoes a ON a.id=NEW.pagamento_alocacao_id
    JOIN pedido_pagamentos pp ON pp.id=a.pagamento_id
    JOIN pedido_item_trocas tr ON tr.id=NEW.pedido_item_troca_id
    WHERE r.id=NEW.reembolso_id AND r.pagamento_id=a.pagamento_id
      AND r.pedido_id=pp.pedido_id AND r.pedido_id=tr.pedido_id
      AND a.pedido_item_id IN (SELECT item_id FROM linhagem)
  )
  OR NEW.valor_centavos + COALESCE((
    SELECT SUM(valor_centavos) FROM (
      SELECT valor_centavos FROM pedido_reembolso_alocacoes
      WHERE pagamento_alocacao_id=NEW.pagamento_alocacao_id
      UNION ALL
      SELECT valor_centavos FROM pedido_item_troca_reembolso_alocacoes
      WHERE pagamento_alocacao_id=NEW.pagamento_alocacao_id
    )
  ),0) > (SELECT valor_centavos FROM pedido_pagamento_alocacoes WHERE id=NEW.pagamento_alocacao_id)
  OR NEW.valor_centavos + COALESCE((
    SELECT SUM(valor_centavos) FROM (
      SELECT valor_centavos FROM pedido_reembolso_alocacoes WHERE reembolso_id=NEW.reembolso_id
      UNION ALL
      SELECT valor_centavos FROM pedido_item_troca_reembolso_alocacoes WHERE reembolso_id=NEW.reembolso_id
    )
  ),0) > (SELECT valor_centavos FROM pedido_reembolsos WHERE id=NEW.reembolso_id)
BEGIN
  SELECT RAISE(ABORT,'troca_reembolso_alocacao_inconsistente');
END;

CREATE TRIGGER pedido_item_troca_reembolsos_validar_update
BEFORE UPDATE OF reembolso_id,pagamento_alocacao_id,pedido_item_troca_id,valor_centavos
ON pedido_item_troca_reembolso_alocacoes
FOR EACH ROW WHEN
  NOT EXISTS (
    WITH RECURSIVE linhagem(item_id) AS (
      SELECT item_origem_id FROM pedido_item_trocas WHERE id=NEW.pedido_item_troca_id
      UNION
      SELECT t.item_origem_id FROM pedido_item_trocas t
      JOIN linhagem l ON l.item_id=t.item_destino_id
      WHERE t.status IN ('CONCLUIDA','AGUARDANDO_COBRANCA')
    )
    SELECT 1 FROM pedido_reembolsos r
    JOIN pedido_pagamento_alocacoes a ON a.id=NEW.pagamento_alocacao_id
    JOIN pedido_pagamentos pp ON pp.id=a.pagamento_id
    JOIN pedido_item_trocas tr ON tr.id=NEW.pedido_item_troca_id
    WHERE r.id=NEW.reembolso_id AND r.pagamento_id=a.pagamento_id
      AND r.pedido_id=pp.pedido_id AND r.pedido_id=tr.pedido_id
      AND a.pedido_item_id IN (SELECT item_id FROM linhagem)
  )
  OR NEW.valor_centavos
     + COALESCE((SELECT SUM(valor_centavos) FROM pedido_reembolso_alocacoes
                 WHERE pagamento_alocacao_id=NEW.pagamento_alocacao_id),0)
     + COALESCE((SELECT SUM(valor_centavos) FROM pedido_item_troca_reembolso_alocacoes
                 WHERE pagamento_alocacao_id=NEW.pagamento_alocacao_id AND id<>OLD.id),0)
     > (SELECT valor_centavos FROM pedido_pagamento_alocacoes WHERE id=NEW.pagamento_alocacao_id)
  OR NEW.valor_centavos
     + COALESCE((SELECT SUM(valor_centavos) FROM pedido_reembolso_alocacoes
                 WHERE reembolso_id=NEW.reembolso_id),0)
     + COALESCE((SELECT SUM(valor_centavos) FROM pedido_item_troca_reembolso_alocacoes
                 WHERE reembolso_id=NEW.reembolso_id AND id<>OLD.id),0)
     > (SELECT valor_centavos FROM pedido_reembolsos WHERE id=NEW.reembolso_id)
BEGIN
  SELECT RAISE(ABORT,'troca_reembolso_alocacao_inconsistente');
END;

CREATE TRIGGER pedido_pagamento_alocacoes_preservar_reembolsos_update
BEFORE UPDATE OF pagamento_id,pedido_item_id,valor_centavos ON pedido_pagamento_alocacoes
FOR EACH ROW WHEN
  NEW.valor_centavos < (
    COALESCE((SELECT SUM(valor_centavos) FROM pedido_reembolso_alocacoes
              WHERE pagamento_alocacao_id=OLD.id),0)
    + COALESCE((SELECT SUM(valor_centavos) FROM pedido_item_troca_reembolso_alocacoes
                WHERE pagamento_alocacao_id=OLD.id),0)
  )
  OR ((NEW.pagamento_id<>OLD.pagamento_id OR NEW.pedido_item_id<>OLD.pedido_item_id)
      AND (EXISTS(SELECT 1 FROM pedido_reembolso_alocacoes WHERE pagamento_alocacao_id=OLD.id)
        OR EXISTS(SELECT 1 FROM pedido_item_troca_reembolso_alocacoes WHERE pagamento_alocacao_id=OLD.id)))
BEGIN
  SELECT RAISE(ABORT,'reembolso_alocacao_inconsistente');
END;

CREATE TRIGGER pedido_item_cancelamentos_preservar_reembolsos_update
BEFORE UPDATE OF pedido_id,pedido_item_id ON pedido_item_cancelamentos
FOR EACH ROW WHEN (NEW.pedido_id<>OLD.pedido_id OR NEW.pedido_item_id<>OLD.pedido_item_id)
  AND EXISTS(SELECT 1 FROM pedido_reembolso_alocacoes
             WHERE pedido_item_cancelamento_id=OLD.id)
BEGIN
  SELECT RAISE(ABORT,'reembolso_alocacao_inconsistente');
END;

CREATE TRIGGER pedido_item_trocas_preservar_reembolsos_update
BEFORE UPDATE OF pedido_id,item_origem_id,item_destino_id,status ON pedido_item_trocas
FOR EACH ROW WHEN
  ((NEW.pedido_id<>OLD.pedido_id OR NEW.item_origem_id<>OLD.item_origem_id)
    AND EXISTS(SELECT 1 FROM pedido_item_troca_reembolso_alocacoes
               WHERE pedido_item_troca_id=OLD.id))
  OR ((NEW.pedido_id<>OLD.pedido_id OR NEW.item_origem_id<>OLD.item_origem_id
       OR NEW.item_destino_id IS NOT OLD.item_destino_id
       OR (OLD.status IN ('CONCLUIDA','AGUARDANDO_COBRANCA')
           AND NEW.status NOT IN ('CONCLUIDA','AGUARDANDO_COBRANCA')))
      AND EXISTS(
        WITH RECURSIVE caminhos(alocacao_id,item_id,usa_aresta) AS (
          SELECT ra.pagamento_alocacao_id,c.pedido_item_id,0
          FROM pedido_reembolso_alocacoes ra
          JOIN pedido_item_cancelamentos c ON c.id=ra.pedido_item_cancelamento_id
          UNION
          SELECT ra.pagamento_alocacao_id,tr.item_origem_id,0
          FROM pedido_item_troca_reembolso_alocacoes ra
          JOIN pedido_item_trocas tr ON tr.id=ra.pedido_item_troca_id
          UNION
          SELECT p.alocacao_id,tr.item_origem_id,
                 CASE WHEN tr.id=OLD.id THEN 1 ELSE p.usa_aresta END
          FROM caminhos p
          JOIN pedido_item_trocas tr ON tr.item_destino_id=p.item_id
          WHERE tr.status IN ('CONCLUIDA','AGUARDANDO_COBRANCA')
        )
        SELECT 1 FROM caminhos p
        JOIN pedido_pagamento_alocacoes a ON a.id=p.alocacao_id
        WHERE p.item_id=a.pedido_item_id AND p.usa_aresta=1
      ))
BEGIN
  SELECT RAISE(ABORT,'reembolso_linhagem_inconsistente');
END;
