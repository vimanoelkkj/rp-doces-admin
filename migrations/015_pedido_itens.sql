-- Adiciona itens normalizados sem remover ou reescrever o snapshot legado de pedidos.
CREATE TABLE IF NOT EXISTS pedido_itens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pedido_id INTEGER NOT NULL,
  produto_id INTEGER,
  produto_nome TEXT NOT NULL,
  quantidade INTEGER NOT NULL CHECK (quantidade >= 1 AND quantidade <= 50),
  valor_unitario_centavos INTEGER NOT NULL CHECK (valor_unitario_centavos >= 0),
  valor_total_centavos INTEGER NOT NULL CHECK (valor_total_centavos >= 0),
  estoque_baixado_em TEXT,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE CASCADE,
  FOREIGN KEY (produto_id) REFERENCES produtos(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_pedido_itens_pedido ON pedido_itens(pedido_id);
CREATE INDEX IF NOT EXISTS idx_pedido_itens_produto ON pedido_itens(produto_id);
CREATE INDEX IF NOT EXISTS idx_pedido_itens_estoque ON pedido_itens(pedido_id, estoque_baixado_em);

-- Cada pedido antigo representa exatamente um item. O snapshot e o marcador de
-- estoque existentes são copiados para preservar integralmente o histórico.
INSERT INTO pedido_itens (
  pedido_id, produto_id, produto_nome, quantidade,
  valor_unitario_centavos, valor_total_centavos, estoque_baixado_em, criado_em
)
SELECT
  p.id, p.produto_id, p.produto_nome, p.quantidade,
  p.valor_unitario_centavos, p.valor_total_centavos, p.estoque_baixado_em, p.criado_em
FROM pedidos p
WHERE NOT EXISTS (
  SELECT 1 FROM pedido_itens i WHERE i.pedido_id = p.id
);
