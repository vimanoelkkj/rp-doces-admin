-- Migration 020: Adiciona timestamp visual de expiração do Pix
ALTER TABLE pedidos ADD COLUMN pix_expira_em TEXT;
