ALTER TABLE pedidos ADD COLUMN status_pedido TEXT NOT NULL DEFAULT 'NOVO';
CREATE INDEX IF NOT EXISTS idx_pedidos_status_pedido ON pedidos(status_pedido, criado_em);
