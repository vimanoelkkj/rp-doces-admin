-- Corrige a exclusao mutua entre intencao POR ITEM e intencao DE ANULACAO
-- (0023): o trigger original bloqueava a criacao de uma intencao de
-- anulacao sempre que existisse QUALQUER intencao por item nao RECUSADA
-- sobre o mesmo pagamento -- inclusive uma ja CONFIRMADA. Um refund por item
-- CONFIRMADO e historico: seu valor ja foi descontado por
-- listarPagamentosMpReembolsaveis, e o restante do pagamento pode e deve ser
-- estornado pela anulacao. Bug real de producao: pedido com refund parcial
-- por item ja CONFIRMADO ficava com "Erro interno ao processar o estorno"
-- ao tentar anular, porque o INSERT da intencao de anulacao era abortado
-- pelo trigger antes de qualquer chamada remota ao Mercado Pago.
--
-- A exclusao mutua passa a ser assimetrica:
--   * anulacao bloqueia SOMENTE se existir intencao por item em estado
--     remoto ainda nao resolvido (PENDENTE, PROCESSANDO, INCONCLUSIVO) --
--     nunca por CONFIRMADO (historico) nem por RECUSADO (nunca moveu
--     dinheiro).
--   * intencao por item continua bloqueando por qualquer intencao de
--     anulacao nao RECUSADA, INCLUSIVE CONFIRMADA -- de proposito: entre o
--     estorno de anulacao confirmado e a anulacao do pedido se efetivar
--     existe uma janela real em que o dinheiro ja voltou e nenhuma operacao
--     por item pode nascer.
--
-- Apenas o trigger muda. Sem rebuild de tabela, sem alterar indices, sem
-- tocar dado nenhum, sem alterar a migration 0023 (ja aplicada em produção).

DROP TRIGGER pedido_reembolso_pix_mp_intencoes_excl_mutua_item_anulacao;

CREATE TRIGGER pedido_reembolso_pix_mp_intencoes_excl_mutua_item_anulacao
BEFORE INSERT ON pedido_reembolso_pix_mp_intencoes
FOR EACH ROW WHEN
  (
    NEW.pedido_item_cancelamento_id IS NULL AND NEW.pedido_item_troca_id IS NULL
    AND EXISTS (
      SELECT 1 FROM pedido_reembolso_pix_mp_intencoes i
      WHERE i.pagamento_id = NEW.pagamento_id
        AND i.status IN ('PENDENTE', 'PROCESSANDO', 'INCONCLUSIVO')
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

PRAGMA foreign_key_check;
