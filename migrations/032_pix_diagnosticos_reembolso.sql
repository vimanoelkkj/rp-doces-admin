ALTER TABLE pix_diagnosticos ADD COLUMN reembolso_status TEXT;
ALTER TABLE pix_diagnosticos ADD COLUMN mp_refund_id TEXT;
ALTER TABLE pix_diagnosticos ADD COLUMN mp_refund_status TEXT;
ALTER TABLE pix_diagnosticos ADD COLUMN reembolso_solicitado_em TEXT;
ALTER TABLE pix_diagnosticos ADD COLUMN reembolsado_em TEXT;

CREATE INDEX IF NOT EXISTS idx_pix_diagnosticos_reembolso_status
  ON pix_diagnosticos(reembolso_status, atualizado_em);
