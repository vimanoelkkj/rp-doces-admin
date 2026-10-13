-- Migration 0041: anulação após estorno integral de Pix Mercado Pago.
--
-- A migration 0040 criou o trigger pedido_anulacoes_bloquear_exposicao_pix_remota recusando
-- QUALQUER histórico PIX_MP, o que impedia excluir um pedido mesmo depois de devolver todo o
-- dinheiro. Este trigger é recriado com o mesmo nome e a mesma contenção, exceto por uma isenção:
-- perna Pix PAGA e INTEGRALMENTE ESTORNADA, isto é:
--   * estornos REEMBOLSADO do próprio pagamento e pedido (MP com mp_refund_id, ou manual PIX_MP)
--     somando EXATAMENTE o valor pago (soma maior é anomalia e continua bloqueando);
--   * sem refund PENDENTE nem intenção PENDENTE/PROCESSANDO/INCONCLUSIVO;
--   * identidade remota coerente (Orders: ORD+PAY; Payments histórico: sem ORD e id numérico) e
--     única no ledger.
-- Uma operação CHECKOUT_SITE/PIX_ADMIN só é isentada quando está CONCLUIDA, é do mesmo pedido e
-- seu mp_payment_id é o da perna quitada; regenerações Pix, operações não concluídas, órfãs ou
-- divergentes, e identidade legada em pedidos.mp_* sem perna quitada correspondente continuam
-- recusando. Cobrança pendente/expirada/cancelada/falha e qualquer estorno parcial também
-- continuam recusando com ANULACAO_EXPOSICAO_PIX_REMOTA.
--
-- Não toca: pedido_anulacoes, pedido_pagamentos, pedido_reembolsos, operações, alocações,
-- estoque, o trigger de captura não conciliada (0040), pedido_anulacoes_validar_mp (0031) nem
-- qualquer dado. Só troca a definição de um trigger BEFORE INSERT: seguro no D1 de produção,
-- sem reconstrução de tabela e sem backfill. A cláusula WHEN espelha
-- exposicaoPixRemotaNoPedidoSql("NEW.pedido_id") (functions/lib/pedidoFinanceiroSql.ts);
-- tests/anulacao-exposicao-pix-remota.test.mjs trava esse contrato e
-- scripts/check-d1-migrations.mjs confere a definição instalada (o nome é igual ao da 0040).

DROP TRIGGER IF EXISTS pedido_anulacoes_bloquear_exposicao_pix_remota;

CREATE TRIGGER pedido_anulacoes_bloquear_exposicao_pix_remota
BEFORE INSERT ON pedido_anulacoes
FOR EACH ROW
WHEN (EXISTS (SELECT 1 FROM pedido_pagamentos ep
            WHERE ep.pedido_id = NEW.pedido_id AND ep.metodo = 'PIX_MP'
              AND NOT COALESCE((ep.metodo = 'PIX_MP' AND ep.status = 'PAGO'
    AND ((ep.mp_order_id GLOB 'ORD?*' AND ep.mp_order_id NOT GLOB '*[^A-Za-z0-9]*'
          AND ep.mp_payment_id GLOB 'PAY?*' AND ep.mp_payment_id NOT GLOB '*[^A-Za-z0-9]*')
      OR (ep.mp_order_id IS NULL AND ep.mp_payment_id GLOB '[1-9]*'
          AND ep.mp_payment_id NOT GLOB '*[^0-9]*'))
    AND NOT EXISTS (SELECT 1 FROM pedido_pagamentos dup
                    WHERE dup.id <> ep.id AND dup.mp_payment_id = ep.mp_payment_id)
    AND ep.valor_centavos = COALESCE((SELECT SUM(rq.valor_centavos) FROM pedido_reembolsos rq
        WHERE rq.pagamento_id = ep.id AND rq.pedido_id = ep.pedido_id
          AND rq.status = 'REEMBOLSADO' AND rq.metodo = 'PIX_MP'
          AND (rq.origem = 'MANUAL' OR (rq.origem = 'MERCADO_PAGO' AND rq.mp_refund_id IS NOT NULL))), 0)
    AND NOT EXISTS (SELECT 1 FROM pedido_reembolsos rp
                    WHERE rp.pagamento_id = ep.id AND rp.status = 'PENDENTE')
    AND NOT EXISTS (SELECT 1 FROM pedido_reembolso_pix_mp_intencoes ri
                    WHERE ri.pagamento_id = ep.id
                      AND ri.status IN ('PENDENTE', 'PROCESSANDO', 'INCONCLUSIVO'))), 0))
    OR EXISTS (SELECT 1 FROM pedido_operacoes eo
               WHERE eo.pedido_id = NEW.pedido_id
                 AND eo.tipo IN ('CHECKOUT_SITE', 'PIX_ADMIN', 'PIX_ADMIN_REGENERACAO')
                 AND NOT COALESCE((eo.tipo IN ('CHECKOUT_SITE', 'PIX_ADMIN') AND eo.fase = 'CONCLUIDA'
                          AND EXISTS (SELECT 1 FROM pedido_pagamentos qp
                                      WHERE qp.id = eo.pagamento_id AND qp.pedido_id = eo.pedido_id
                                        AND qp.mp_payment_id = eo.mp_payment_id
                                        AND COALESCE((qp.metodo = 'PIX_MP' AND qp.status = 'PAGO'
    AND ((qp.mp_order_id GLOB 'ORD?*' AND qp.mp_order_id NOT GLOB '*[^A-Za-z0-9]*'
          AND qp.mp_payment_id GLOB 'PAY?*' AND qp.mp_payment_id NOT GLOB '*[^A-Za-z0-9]*')
      OR (qp.mp_order_id IS NULL AND qp.mp_payment_id GLOB '[1-9]*'
          AND qp.mp_payment_id NOT GLOB '*[^0-9]*'))
    AND NOT EXISTS (SELECT 1 FROM pedido_pagamentos dup
                    WHERE dup.id <> qp.id AND dup.mp_payment_id = qp.mp_payment_id)
    AND qp.valor_centavos = COALESCE((SELECT SUM(rq.valor_centavos) FROM pedido_reembolsos rq
        WHERE rq.pagamento_id = qp.id AND rq.pedido_id = qp.pedido_id
          AND rq.status = 'REEMBOLSADO' AND rq.metodo = 'PIX_MP'
          AND (rq.origem = 'MANUAL' OR (rq.origem = 'MERCADO_PAGO' AND rq.mp_refund_id IS NOT NULL))), 0)
    AND NOT EXISTS (SELECT 1 FROM pedido_reembolsos rp
                    WHERE rp.pagamento_id = qp.id AND rp.status = 'PENDENTE')
    AND NOT EXISTS (SELECT 1 FROM pedido_reembolso_pix_mp_intencoes ri
                    WHERE ri.pagamento_id = qp.id
                      AND ri.status IN ('PENDENTE', 'PROCESSANDO', 'INCONCLUSIVO'))), 0))), 0))
    OR EXISTS (SELECT 1 FROM pedidos el
               WHERE el.id = NEW.pedido_id
                 AND ((el.mp_payment_id IS NOT NULL
                       AND NOT EXISTS (SELECT 1 FROM pedido_pagamentos lp
                                       WHERE lp.pedido_id = el.id AND lp.mp_payment_id = el.mp_payment_id
                                         AND COALESCE((lp.metodo = 'PIX_MP' AND lp.status = 'PAGO'
    AND ((lp.mp_order_id GLOB 'ORD?*' AND lp.mp_order_id NOT GLOB '*[^A-Za-z0-9]*'
          AND lp.mp_payment_id GLOB 'PAY?*' AND lp.mp_payment_id NOT GLOB '*[^A-Za-z0-9]*')
      OR (lp.mp_order_id IS NULL AND lp.mp_payment_id GLOB '[1-9]*'
          AND lp.mp_payment_id NOT GLOB '*[^0-9]*'))
    AND NOT EXISTS (SELECT 1 FROM pedido_pagamentos dup
                    WHERE dup.id <> lp.id AND dup.mp_payment_id = lp.mp_payment_id)
    AND lp.valor_centavos = COALESCE((SELECT SUM(rq.valor_centavos) FROM pedido_reembolsos rq
        WHERE rq.pagamento_id = lp.id AND rq.pedido_id = lp.pedido_id
          AND rq.status = 'REEMBOLSADO' AND rq.metodo = 'PIX_MP'
          AND (rq.origem = 'MANUAL' OR (rq.origem = 'MERCADO_PAGO' AND rq.mp_refund_id IS NOT NULL))), 0)
    AND NOT EXISTS (SELECT 1 FROM pedido_reembolsos rp
                    WHERE rp.pagamento_id = lp.id AND rp.status = 'PENDENTE')
    AND NOT EXISTS (SELECT 1 FROM pedido_reembolso_pix_mp_intencoes ri
                    WHERE ri.pagamento_id = lp.id
                      AND ri.status IN ('PENDENTE', 'PROCESSANDO', 'INCONCLUSIVO'))), 0)))
                   OR (el.mp_payment_id IS NULL
                       AND (el.mp_qr_code IS NOT NULL OR el.mp_qr_code_base64 IS NOT NULL
                         OR el.mp_ticket_url IS NOT NULL)))))
BEGIN
  SELECT RAISE(ABORT, 'ANULACAO_EXPOSICAO_PIX_REMOTA');
END;
