-- Migration 0041: anulação após estorno integral de Pix Mercado Pago.
--
-- A migration 0040 criou o trigger pedido_anulacoes_bloquear_exposicao_pix_remota recusando
-- QUALQUER histórico PIX_MP, o que impedia excluir um pedido mesmo depois de devolver todo o
-- dinheiro. Este trigger é recriado com o mesmo nome e a mesma contenção, exceto por uma isenção:
-- perna Pix PAGA e INTEGRALMENTE ESTORNADA (estorno MP com mp_refund_id ou manual PIX_MP
-- confirmado, sem refund pendente nem intenção em andamento/inconclusiva), mais as operações e
-- colunas legadas que descrevem apenas essa perna. Cobrança pendente/expirada/cancelada/falha,
-- operação sem perna quitada, identidade legada sem correspondência e qualquer estorno parcial
-- continuam recusando com ANULACAO_EXPOSICAO_PIX_REMOTA.
--
-- Não toca: pedido_anulacoes, pedido_pagamentos, pedido_reembolsos, operações, alocações,
-- estoque, o trigger de captura não conciliada (0040), pedido_anulacoes_validar_mp (0031) nem
-- qualquer dado. Só troca a definição de um trigger BEFORE INSERT: seguro no D1 de produção,
-- sem reconstrução de tabela e sem backfill. A cláusula WHEN espelha
-- exposicaoPixRemotaNoPedidoSql("NEW.pedido_id") (functions/lib/pedidoFinanceiroSql.ts);
-- tests/anulacao-exposicao-pix-remota.test.mjs trava esse contrato.

DROP TRIGGER IF EXISTS pedido_anulacoes_bloquear_exposicao_pix_remota;

CREATE TRIGGER pedido_anulacoes_bloquear_exposicao_pix_remota
BEFORE INSERT ON pedido_anulacoes
FOR EACH ROW
WHEN (EXISTS (SELECT 1 FROM pedido_pagamentos ep
            WHERE ep.pedido_id = NEW.pedido_id AND ep.metodo = 'PIX_MP'
              AND NOT (ep.metodo = 'PIX_MP' AND ep.status = 'PAGO'
    AND ep.valor_centavos <= COALESCE((SELECT SUM(rq.valor_centavos) FROM pedido_reembolsos rq
        WHERE rq.pagamento_id = ep.id AND rq.status = 'REEMBOLSADO' AND rq.metodo = 'PIX_MP'
          AND (rq.origem = 'MANUAL' OR (rq.origem = 'MERCADO_PAGO' AND rq.mp_refund_id IS NOT NULL))), 0)
    AND NOT EXISTS (SELECT 1 FROM pedido_reembolsos rp
                    WHERE rp.pagamento_id = ep.id AND rp.status = 'PENDENTE')
    AND NOT EXISTS (SELECT 1 FROM pedido_reembolso_pix_mp_intencoes ri
                    WHERE ri.pagamento_id = ep.id
                      AND ri.status IN ('PENDENTE', 'PROCESSANDO', 'INCONCLUSIVO'))))
    OR EXISTS (SELECT 1 FROM pedido_operacoes eo
               WHERE eo.pedido_id = NEW.pedido_id
                 AND eo.tipo IN ('CHECKOUT_SITE', 'PIX_ADMIN', 'PIX_ADMIN_REGENERACAO')
                 AND NOT EXISTS (SELECT 1 FROM pedido_pagamentos qp
                                 WHERE qp.id = eo.pagamento_id AND (qp.metodo = 'PIX_MP' AND qp.status = 'PAGO'
    AND qp.valor_centavos <= COALESCE((SELECT SUM(rq.valor_centavos) FROM pedido_reembolsos rq
        WHERE rq.pagamento_id = qp.id AND rq.status = 'REEMBOLSADO' AND rq.metodo = 'PIX_MP'
          AND (rq.origem = 'MANUAL' OR (rq.origem = 'MERCADO_PAGO' AND rq.mp_refund_id IS NOT NULL))), 0)
    AND NOT EXISTS (SELECT 1 FROM pedido_reembolsos rp
                    WHERE rp.pagamento_id = qp.id AND rp.status = 'PENDENTE')
    AND NOT EXISTS (SELECT 1 FROM pedido_reembolso_pix_mp_intencoes ri
                    WHERE ri.pagamento_id = qp.id
                      AND ri.status IN ('PENDENTE', 'PROCESSANDO', 'INCONCLUSIVO')))))
    OR EXISTS (SELECT 1 FROM pedidos el
               WHERE el.id = NEW.pedido_id
                 AND ((el.mp_payment_id IS NOT NULL
                       AND NOT EXISTS (SELECT 1 FROM pedido_pagamentos lp
                                       WHERE lp.pedido_id = el.id AND lp.mp_payment_id = el.mp_payment_id
                                         AND (lp.metodo = 'PIX_MP' AND lp.status = 'PAGO'
    AND lp.valor_centavos <= COALESCE((SELECT SUM(rq.valor_centavos) FROM pedido_reembolsos rq
        WHERE rq.pagamento_id = lp.id AND rq.status = 'REEMBOLSADO' AND rq.metodo = 'PIX_MP'
          AND (rq.origem = 'MANUAL' OR (rq.origem = 'MERCADO_PAGO' AND rq.mp_refund_id IS NOT NULL))), 0)
    AND NOT EXISTS (SELECT 1 FROM pedido_reembolsos rp
                    WHERE rp.pagamento_id = lp.id AND rp.status = 'PENDENTE')
    AND NOT EXISTS (SELECT 1 FROM pedido_reembolso_pix_mp_intencoes ri
                    WHERE ri.pagamento_id = lp.id
                      AND ri.status IN ('PENDENTE', 'PROCESSANDO', 'INCONCLUSIVO')))))
                   OR (el.mp_payment_id IS NULL
                       AND (el.mp_qr_code IS NOT NULL OR el.mp_qr_code_base64 IS NOT NULL
                         OR el.mp_ticket_url IS NOT NULL)))))
BEGIN
  SELECT RAISE(ABORT, 'ANULACAO_EXPOSICAO_PIX_REMOTA');
END;
