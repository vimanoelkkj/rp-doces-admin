-- Pedidos registrados pelo painel (balcão, WhatsApp, boca a boca etc.).
-- Pedidos existentes continuam sendo considerados originados pelo site.
ALTER TABLE pedidos ADD COLUMN origem_pedido TEXT NOT NULL DEFAULT 'SITE'
  CHECK (origem_pedido IN ('SITE', 'MANUAL'));

CREATE INDEX IF NOT EXISTS idx_pedidos_origem
ON pedidos(origem_pedido, criado_em);
