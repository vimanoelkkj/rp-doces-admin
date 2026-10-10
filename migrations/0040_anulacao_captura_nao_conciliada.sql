-- P0: refuse order voids while a remote Pix capture remains unreconciled.
-- Additive only: preserve all existing triggers, ledger rows, refunds,
-- snapshots, stock and idempotency. No table rebuild or data mutation.
-- The WHEN clause mirrors capturaNaoConciliadaNoPedidoSql("NEW.pedido_id");
-- tests/anulacao-captura-nao-conciliada.test.mjs locks this shared F1 contract.
-- ABORT prevents the void snapshot and rolls back the enclosing D1 batch.

CREATE TRIGGER pedido_anulacoes_bloquear_captura_nao_conciliada
BEFORE INSERT ON pedido_anulacoes
FOR EACH ROW
WHEN EXISTS (SELECT 1 FROM pedido_pagamentos nc
             WHERE nc.pedido_id=NEW.pedido_id AND (nc.metodo = 'PIX_MP' AND nc.status NOT IN ('PAGO', 'REEMBOLSADO')
               AND LOWER(COALESCE(nc.mp_status, '')) IN ('approved', 'refunded')))
BEGIN
  SELECT RAISE(ABORT, 'CAPTURA_MP_NAO_CONCILIADA');
END;

-- Conservative containment also refuses undiscovered captures and historical identities.
-- Mirrors exposicaoPixRemotaNoPedidoSql("NEW.pedido_id"); terminal states are not proof.
-- Existing void replays do not INSERT, and reconciliation/refund writes are untouched.
CREATE TRIGGER pedido_anulacoes_bloquear_exposicao_pix_remota
BEFORE INSERT ON pedido_anulacoes
FOR EACH ROW
WHEN (EXISTS (SELECT 1 FROM pedido_pagamentos ep
              WHERE ep.pedido_id = NEW.pedido_id AND ep.metodo = 'PIX_MP')
      OR EXISTS (SELECT 1 FROM pedido_operacoes eo
                 WHERE eo.pedido_id = NEW.pedido_id
                   AND eo.tipo IN ('CHECKOUT_SITE', 'PIX_ADMIN', 'PIX_ADMIN_REGENERACAO'))
      OR EXISTS (SELECT 1 FROM pedidos el
                 WHERE el.id = NEW.pedido_id
                   AND (el.mp_payment_id IS NOT NULL OR el.mp_qr_code IS NOT NULL
                     OR el.mp_qr_code_base64 IS NOT NULL OR el.mp_ticket_url IS NOT NULL)))
BEGIN
  SELECT RAISE(ABORT, 'ANULACAO_EXPOSICAO_PIX_REMOTA');
END;
