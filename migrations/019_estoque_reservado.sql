-- Migration 019: Reserva Temporária de Estoque e Prevenção de Overselling
ALTER TABLE produtos ADD COLUMN estoque_reservado INTEGER NOT NULL DEFAULT 0 CHECK (estoque_reservado >= 0 AND estoque_reservado <= estoque);

ALTER TABLE pedidos ADD COLUMN reserva_status TEXT NOT NULL DEFAULT 'SEM_RESERVA' CHECK (reserva_status IN ('SEM_RESERVA', 'ATIVA', 'CONVERTIDA', 'LIBERADA'));
ALTER TABLE pedidos ADD COLUMN reserva_expira_em TEXT;
ALTER TABLE pedidos ADD COLUMN reserva_liberada_em TEXT;

CREATE INDEX IF NOT EXISTS idx_pedidos_reserva_ativa
ON pedidos(reserva_expira_em)
WHERE status_pagamento = 'PENDENTE' AND reserva_status = 'ATIVA';

