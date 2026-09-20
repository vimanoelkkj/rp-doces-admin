-- Anulacao auditavel, independente de arquivamento/cancelamento/refund.
-- Aplicar antes do codigo. Nenhuma linha historica e reescrita.
CREATE TABLE pedido_anulacoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pedido_id INTEGER NOT NULL UNIQUE REFERENCES pedidos(id) ON DELETE RESTRICT,
  motivo TEXT NOT NULL DEFAULT '' CHECK(length(motivo)<=300),
  estoque_acao TEXT NOT NULL CHECK(estoque_acao IN ('DEVOLVER','MANTER')),
  criado_por_usuario_id INTEGER REFERENCES usuarios_admin(id) ON DELETE SET NULL,
  usuario_nome TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  total_original_centavos INTEGER NOT NULL CHECK(total_original_centavos>=0),
  bruto_original_centavos INTEGER NOT NULL CHECK(bruto_original_centavos>=0),
  reembolsado_original_centavos INTEGER NOT NULL CHECK(reembolsado_original_centavos>=0),
  liquido_original_centavos INTEGER NOT NULL CHECK(liquido_original_centavos>=0),
  estoque_snapshot TEXT NOT NULL CHECK(json_valid(estoque_snapshot)),
  -- 0 existe apenas dentro do batch atomico; o ultimo statement fecha a trava.
  efetivada INTEGER NOT NULL DEFAULT 0 CHECK(efetivada IN (0,1))
);

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

CREATE TRIGGER pedido_anulacoes_imutavel_update
BEFORE UPDATE ON pedido_anulacoes
WHEN OLD.efetivada=1 AND (
  NEW.pedido_id IS NOT OLD.pedido_id OR NEW.motivo IS NOT OLD.motivo
  OR NEW.estoque_acao IS NOT OLD.estoque_acao OR NEW.usuario_nome IS NOT OLD.usuario_nome
  OR NEW.criado_em IS NOT OLD.criado_em OR NEW.efetivada IS NOT OLD.efetivada
  OR NEW.total_original_centavos IS NOT OLD.total_original_centavos
  OR NEW.bruto_original_centavos IS NOT OLD.bruto_original_centavos
  OR NEW.reembolsado_original_centavos IS NOT OLD.reembolsado_original_centavos
  OR NEW.liquido_original_centavos IS NOT OLD.liquido_original_centavos
  OR NEW.estoque_snapshot IS NOT OLD.estoque_snapshot
  OR (NEW.criado_por_usuario_id IS NOT OLD.criado_por_usuario_id AND NEW.criado_por_usuario_id IS NOT NULL)
)
BEGIN
  SELECT RAISE(ABORT,'PEDIDO_ANULADO');
END;
CREATE TRIGGER pedido_anulacoes_imutavel_delete BEFORE DELETE ON pedido_anulacoes
BEGIN
  SELECT RAISE(ABORT,'PEDIDO_ANULADO');
END;

-- Defesa transacional contra mutacoes que passaram pela autorizacao antes
-- de outra aba anular o pedido. RAISE(ABORT) reverte o batch, inclusive estoque.
CREATE TRIGGER pedidos_anulado_update
BEFORE UPDATE ON pedidos
WHEN EXISTS(SELECT 1 FROM pedido_anulacoes WHERE pedido_id=OLD.id AND efetivada=1) OR EXISTS(SELECT 1 FROM pedido_anulacoes WHERE pedido_id=NEW.id AND efetivada=1)
BEGIN
  SELECT RAISE(ABORT,'PEDIDO_ANULADO');
END;
CREATE TRIGGER pedidos_anulado_delete
BEFORE DELETE ON pedidos
WHEN EXISTS(SELECT 1 FROM pedido_anulacoes WHERE pedido_id=OLD.id AND efetivada=1)
BEGIN
  SELECT RAISE(ABORT,'PEDIDO_ANULADO');
END;
CREATE TRIGGER pedido_itens_anulado_insert
BEFORE INSERT ON pedido_itens
WHEN EXISTS(SELECT 1 FROM pedido_anulacoes WHERE pedido_id=NEW.pedido_id AND efetivada=1)
BEGIN
  SELECT RAISE(ABORT,'PEDIDO_ANULADO');
END;
CREATE TRIGGER pedido_itens_anulado_update
BEFORE UPDATE ON pedido_itens
WHEN EXISTS(SELECT 1 FROM pedido_anulacoes WHERE pedido_id=OLD.pedido_id AND efetivada=1) OR EXISTS(SELECT 1 FROM pedido_anulacoes WHERE pedido_id=NEW.pedido_id AND efetivada=1)
BEGIN
  SELECT RAISE(ABORT,'PEDIDO_ANULADO');
END;
CREATE TRIGGER pedido_itens_anulado_delete
BEFORE DELETE ON pedido_itens
WHEN EXISTS(SELECT 1 FROM pedido_anulacoes WHERE pedido_id=OLD.pedido_id AND efetivada=1)
BEGIN
  SELECT RAISE(ABORT,'PEDIDO_ANULADO');
END;
CREATE TRIGGER pedido_pagamentos_anulado_insert
BEFORE INSERT ON pedido_pagamentos
WHEN EXISTS(SELECT 1 FROM pedido_anulacoes WHERE pedido_id=NEW.pedido_id AND efetivada=1)
BEGIN
  SELECT RAISE(ABORT,'PEDIDO_ANULADO');
END;
CREATE TRIGGER pedido_pagamentos_anulado_update
BEFORE UPDATE ON pedido_pagamentos
WHEN EXISTS(SELECT 1 FROM pedido_anulacoes WHERE pedido_id=OLD.pedido_id AND efetivada=1) OR EXISTS(SELECT 1 FROM pedido_anulacoes WHERE pedido_id=NEW.pedido_id AND efetivada=1)
BEGIN
  SELECT RAISE(ABORT,'PEDIDO_ANULADO');
END;
CREATE TRIGGER pedido_pagamentos_anulado_delete
BEFORE DELETE ON pedido_pagamentos
WHEN EXISTS(SELECT 1 FROM pedido_anulacoes WHERE pedido_id=OLD.pedido_id AND efetivada=1)
BEGIN
  SELECT RAISE(ABORT,'PEDIDO_ANULADO');
END;
CREATE TRIGGER pedido_reembolsos_anulado_insert
BEFORE INSERT ON pedido_reembolsos
WHEN EXISTS(SELECT 1 FROM pedido_anulacoes WHERE pedido_id=NEW.pedido_id AND efetivada=1)
BEGIN
  SELECT RAISE(ABORT,'PEDIDO_ANULADO');
END;
CREATE TRIGGER pedido_reembolsos_anulado_update
BEFORE UPDATE ON pedido_reembolsos
WHEN EXISTS(SELECT 1 FROM pedido_anulacoes WHERE pedido_id=OLD.pedido_id AND efetivada=1) OR EXISTS(SELECT 1 FROM pedido_anulacoes WHERE pedido_id=NEW.pedido_id AND efetivada=1)
BEGIN
  SELECT RAISE(ABORT,'PEDIDO_ANULADO');
END;
CREATE TRIGGER pedido_reembolsos_anulado_delete
BEFORE DELETE ON pedido_reembolsos
WHEN EXISTS(SELECT 1 FROM pedido_anulacoes WHERE pedido_id=OLD.pedido_id AND efetivada=1)
BEGIN
  SELECT RAISE(ABORT,'PEDIDO_ANULADO');
END;
CREATE TRIGGER pedido_item_cancelamentos_anulado_insert
BEFORE INSERT ON pedido_item_cancelamentos
WHEN EXISTS(SELECT 1 FROM pedido_anulacoes WHERE pedido_id=NEW.pedido_id AND efetivada=1)
BEGIN
  SELECT RAISE(ABORT,'PEDIDO_ANULADO');
END;
CREATE TRIGGER pedido_item_cancelamentos_anulado_update
BEFORE UPDATE ON pedido_item_cancelamentos
WHEN EXISTS(SELECT 1 FROM pedido_anulacoes WHERE pedido_id=OLD.pedido_id AND efetivada=1) OR EXISTS(SELECT 1 FROM pedido_anulacoes WHERE pedido_id=NEW.pedido_id AND efetivada=1)
BEGIN
  SELECT RAISE(ABORT,'PEDIDO_ANULADO');
END;
CREATE TRIGGER pedido_item_cancelamentos_anulado_delete
BEFORE DELETE ON pedido_item_cancelamentos
WHEN EXISTS(SELECT 1 FROM pedido_anulacoes WHERE pedido_id=OLD.pedido_id AND efetivada=1)
BEGIN
  SELECT RAISE(ABORT,'PEDIDO_ANULADO');
END;
CREATE TRIGGER pedido_item_trocas_anulado_insert
BEFORE INSERT ON pedido_item_trocas
WHEN EXISTS(SELECT 1 FROM pedido_anulacoes WHERE pedido_id=NEW.pedido_id AND efetivada=1)
BEGIN
  SELECT RAISE(ABORT,'PEDIDO_ANULADO');
END;
CREATE TRIGGER pedido_item_trocas_anulado_update
BEFORE UPDATE ON pedido_item_trocas
WHEN EXISTS(SELECT 1 FROM pedido_anulacoes WHERE pedido_id=OLD.pedido_id AND efetivada=1) OR EXISTS(SELECT 1 FROM pedido_anulacoes WHERE pedido_id=NEW.pedido_id AND efetivada=1)
BEGIN
  SELECT RAISE(ABORT,'PEDIDO_ANULADO');
END;
CREATE TRIGGER pedido_item_trocas_anulado_delete
BEFORE DELETE ON pedido_item_trocas
WHEN EXISTS(SELECT 1 FROM pedido_anulacoes WHERE pedido_id=OLD.pedido_id AND efetivada=1)
BEGIN
  SELECT RAISE(ABORT,'PEDIDO_ANULADO');
END;
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
CREATE TRIGGER pedido_operacoes_anulado_insert
BEFORE INSERT ON pedido_operacoes
WHEN EXISTS(SELECT 1 FROM pedido_anulacoes WHERE pedido_id=NEW.pedido_id AND efetivada=1)
BEGIN
  SELECT RAISE(ABORT,'PEDIDO_ANULADO');
END;
CREATE TRIGGER pedido_operacoes_anulado_update
BEFORE UPDATE ON pedido_operacoes
WHEN EXISTS(SELECT 1 FROM pedido_anulacoes WHERE pedido_id=OLD.pedido_id AND efetivada=1) OR EXISTS(SELECT 1 FROM pedido_anulacoes WHERE pedido_id=NEW.pedido_id AND efetivada=1)
BEGIN
  SELECT RAISE(ABORT,'PEDIDO_ANULADO');
END;
CREATE TRIGGER pedido_operacoes_anulado_delete
BEFORE DELETE ON pedido_operacoes
WHEN EXISTS(SELECT 1 FROM pedido_anulacoes WHERE pedido_id=OLD.pedido_id AND efetivada=1)
BEGIN
  SELECT RAISE(ABORT,'PEDIDO_ANULADO');
END;
CREATE TRIGGER pedido_pagamento_alocacoes_anulado_insert
BEFORE INSERT ON pedido_pagamento_alocacoes
WHEN EXISTS(SELECT 1 FROM pedido_anulacoes WHERE pedido_id=(SELECT pedido_id FROM pedido_pagamentos WHERE id=NEW.pagamento_id) AND efetivada=1)
BEGIN
  SELECT RAISE(ABORT,'PEDIDO_ANULADO');
END;
CREATE TRIGGER pedido_pagamento_alocacoes_anulado_update
BEFORE UPDATE ON pedido_pagamento_alocacoes
WHEN EXISTS(SELECT 1 FROM pedido_anulacoes WHERE pedido_id=(SELECT pedido_id FROM pedido_pagamentos WHERE id=OLD.pagamento_id) AND efetivada=1) OR EXISTS(SELECT 1 FROM pedido_anulacoes WHERE pedido_id=(SELECT pedido_id FROM pedido_pagamentos WHERE id=NEW.pagamento_id) AND efetivada=1)
BEGIN
  SELECT RAISE(ABORT,'PEDIDO_ANULADO');
END;
CREATE TRIGGER pedido_pagamento_alocacoes_anulado_delete
BEFORE DELETE ON pedido_pagamento_alocacoes
WHEN EXISTS(SELECT 1 FROM pedido_anulacoes WHERE pedido_id=(SELECT pedido_id FROM pedido_pagamentos WHERE id=OLD.pagamento_id) AND efetivada=1)
BEGIN
  SELECT RAISE(ABORT,'PEDIDO_ANULADO');
END;
CREATE TRIGGER pedido_reembolso_alocacoes_anulado_insert
BEFORE INSERT ON pedido_reembolso_alocacoes
WHEN EXISTS(SELECT 1 FROM pedido_anulacoes WHERE pedido_id=(SELECT pedido_id FROM pedido_reembolsos WHERE id=NEW.reembolso_id) AND efetivada=1)
BEGIN
  SELECT RAISE(ABORT,'PEDIDO_ANULADO');
END;
CREATE TRIGGER pedido_reembolso_alocacoes_anulado_update
BEFORE UPDATE ON pedido_reembolso_alocacoes
WHEN EXISTS(SELECT 1 FROM pedido_anulacoes WHERE pedido_id=(SELECT pedido_id FROM pedido_reembolsos WHERE id=OLD.reembolso_id) AND efetivada=1) OR EXISTS(SELECT 1 FROM pedido_anulacoes WHERE pedido_id=(SELECT pedido_id FROM pedido_reembolsos WHERE id=NEW.reembolso_id) AND efetivada=1)
BEGIN
  SELECT RAISE(ABORT,'PEDIDO_ANULADO');
END;
CREATE TRIGGER pedido_reembolso_alocacoes_anulado_delete
BEFORE DELETE ON pedido_reembolso_alocacoes
WHEN EXISTS(SELECT 1 FROM pedido_anulacoes WHERE pedido_id=(SELECT pedido_id FROM pedido_reembolsos WHERE id=OLD.reembolso_id) AND efetivada=1)
BEGIN
  SELECT RAISE(ABORT,'PEDIDO_ANULADO');
END;
CREATE TRIGGER pedido_item_troca_reembolso_alocacoes_anulado_insert
BEFORE INSERT ON pedido_item_troca_reembolso_alocacoes
WHEN EXISTS(SELECT 1 FROM pedido_anulacoes WHERE pedido_id=(SELECT pedido_id FROM pedido_reembolsos WHERE id=NEW.reembolso_id) AND efetivada=1)
BEGIN
  SELECT RAISE(ABORT,'PEDIDO_ANULADO');
END;
CREATE TRIGGER pedido_item_troca_reembolso_alocacoes_anulado_update
BEFORE UPDATE ON pedido_item_troca_reembolso_alocacoes
WHEN EXISTS(SELECT 1 FROM pedido_anulacoes WHERE pedido_id=(SELECT pedido_id FROM pedido_reembolsos WHERE id=OLD.reembolso_id) AND efetivada=1) OR EXISTS(SELECT 1 FROM pedido_anulacoes WHERE pedido_id=(SELECT pedido_id FROM pedido_reembolsos WHERE id=NEW.reembolso_id) AND efetivada=1)
BEGIN
  SELECT RAISE(ABORT,'PEDIDO_ANULADO');
END;
CREATE TRIGGER pedido_item_troca_reembolso_alocacoes_anulado_delete
BEFORE DELETE ON pedido_item_troca_reembolso_alocacoes
WHEN EXISTS(SELECT 1 FROM pedido_anulacoes WHERE pedido_id=(SELECT pedido_id FROM pedido_reembolsos WHERE id=OLD.reembolso_id) AND efetivada=1)
BEGIN
  SELECT RAISE(ABORT,'PEDIDO_ANULADO');
END;
