ALTER TABLE produtos ADD COLUMN estoque INTEGER NOT NULL DEFAULT 0 CHECK (estoque >= 0);
ALTER TABLE pedidos ADD COLUMN estoque_baixado_em TEXT;
CREATE INDEX IF NOT EXISTS idx_pedidos_estoque_baixado ON pedidos(status_pagamento, estoque_baixado_em);
