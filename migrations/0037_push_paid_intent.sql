-- Migration 0037: Durable notification intent in the existing payment write.
-- Additive metadata only: no changes to amounts, ledger guards, refunds or stock.
-- Existing payments default to no intent: never backfill notifications from PAGO.
-- The manual author snapshot has no FK, so admin deletion cannot erase exclusion.
ALTER TABLE pedido_pagamentos ADD COLUMN push_pedido_pago INTEGER NOT NULL DEFAULT 0
  CHECK (push_pedido_pago IN (0, 1));
ALTER TABLE pedido_pagamentos ADD COLUMN push_exclude_usuario_id INTEGER;
CREATE INDEX idx_pagamentos_push_intent ON pedido_pagamentos(id)
  WHERE push_pedido_pago = 1;
