-- M3: a capacidade de refund de um pagamento nunca ultrapassa o que foi pago.
--
-- Corrida confirmada (tests/admin-order-void-estorno.test.mjs, M3): o refund
-- manual PIX_MP lia "sem intencao ativa", uma intencao remota de anulacao
-- nascia com o valor integral, e o manual inseria depois. A guarda do manual
-- so somava refunds ja materializados, e a intencao nao via o manual: juntos
-- chegavam a 13000 sobre um pagamento de 10000.
--
-- A capacidade passa a ser garantida no banco, em qualquer ordem:
--   capacidade usada = refunds REEMBOLSADO do pagamento (qualquer origem)
--                    + intencoes PIX_MP ainda nao resolvidas
--                      (PENDENTE, PROCESSANDO, INCONCLUSIVO)
-- CONFIRMADO fica de fora da soma de intencoes porque o dinheiro ja esta
-- materializado em pedido_reembolsos (mesmo batch que confirma). RECUSADO
-- nao moveu dinheiro.
--
-- Somente cria triggers novos e recria um trigger existente. Nenhuma tabela,
-- indice ou dado e alterado. Migrations anteriores permanecem intactas.

-- Guarda 1: toda intencao PIX_MP (anulacao, cancelamento ou troca) so nasce
-- se couber na capacidade restante do pagamento. Aborta o batch inteiro que a
-- cria, inclusive a pedido_operacoes do mesmo batch.
CREATE TRIGGER pix_mp_refund_intencao_capacidade
BEFORE INSERT ON pedido_reembolso_pix_mp_intencoes
FOR EACH ROW WHEN
  NEW.valor_centavos
  + COALESCE((SELECT SUM(r.valor_centavos) FROM pedido_reembolsos r
      WHERE r.pagamento_id = NEW.pagamento_id AND r.status = 'REEMBOLSADO'), 0)
  + COALESCE((SELECT SUM(i.valor_centavos) FROM pedido_reembolso_pix_mp_intencoes i
      WHERE i.pagamento_id = NEW.pagamento_id
        AND i.status IN ('PENDENTE', 'PROCESSANDO', 'INCONCLUSIVO')), 0)
  > COALESCE((SELECT pp.valor_centavos FROM pedido_pagamentos pp WHERE pp.id = NEW.pagamento_id), 0)
BEGIN
  SELECT RAISE(ABORT, 'pix_mp_refund_capacidade_excedida');
END;

-- Guarda 2: refund manual PIX_MP nao pode nascer enquanto uma intencao
-- remota do mesmo pagamento ainda pode mover dinheiro. Nao se aplica a
-- origem MERCADO_PAGO: a materializacao do refund remoto acontece justamente
-- enquanto a intencao ainda esta PROCESSANDO.
CREATE TRIGGER pix_mp_refund_manual_sem_intencao_ativa
BEFORE INSERT ON pedido_reembolsos
FOR EACH ROW WHEN
  NEW.origem = 'MANUAL' AND NEW.metodo = 'PIX_MP' AND NEW.status = 'REEMBOLSADO'
  AND EXISTS (
    SELECT 1 FROM pedido_reembolso_pix_mp_intencoes i
    WHERE i.pagamento_id = NEW.pagamento_id
      AND i.status IN ('PENDENTE', 'PROCESSANDO', 'INCONCLUSIVO')
  )
BEGIN
  SELECT RAISE(ABORT, 'pix_mp_refund_manual_conflito_intencao');
END;

-- A anulacao considerava "estornado" apenas o que voltou pelo Mercado Pago.
-- Com um refund manual PIX_MP registrado ("Pix devolvido por fora"), isso
-- exigia um refund remoto do valor integral (devolucao acima do pago) e, com
-- a Guarda 1, tornaria a anulacao impossivel. Passa a contar tambem o refund
-- MANUAL com metodo PIX_MP. Refund manual de outro metodo continua nao
-- provando a devolucao do Pix. Demais condicoes identicas as da 0023.
DROP TRIGGER pedido_anulacoes_validar_mp;

CREATE TRIGGER pedido_anulacoes_validar_mp
BEFORE INSERT ON pedido_anulacoes
BEGIN
  SELECT RAISE(ABORT,'ANULACAO_MP_RECEBIDO') WHERE EXISTS (
    SELECT 1 FROM pedido_pagamentos pp WHERE pp.pedido_id=NEW.pedido_id
      AND pp.metodo='PIX_MP' AND pp.status='PAGO'
      AND pp.valor_centavos>COALESCE((SELECT SUM(r.valor_centavos) FROM pedido_reembolsos r
        WHERE r.pagamento_id=pp.id AND r.status='REEMBOLSADO' AND r.metodo='PIX_MP'
          AND (r.origem='MANUAL' OR (r.origem='MERCADO_PAGO' AND r.mp_refund_id IS NOT NULL))),0)
  );
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
