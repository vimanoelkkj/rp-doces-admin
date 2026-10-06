-- Migration 0035: Explicit push event claim lease for at-least-once delivery.
-- Additive only: no changes to orders, payments, refunds, ledger or stock.
-- Legacy pending events become eligible after a deployment grace period;
-- atualizado_em keeps its retry/backoff semantics and is never used as the lease.
ALTER TABLE push_eventos ADD COLUMN claim_token TEXT;
ALTER TABLE push_eventos ADD COLUMN claim_expires_at TEXT;

UPDATE push_eventos SET claim_expires_at = datetime('now', '+120 seconds')
WHERE status = 'PENDENTE';
