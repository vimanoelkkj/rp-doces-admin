-- Migration 0036: Persist the paid-order push recipient exclusion across recovery.
-- Additive only: no changes to payments, refunds, ledger, orders or stock.
-- NULL preserves normal delivery and existing events. No foreign key is needed:
-- deleting an administrator must not erase the original delivery policy.
ALTER TABLE push_eventos ADD COLUMN exclude_usuario_id INTEGER;
