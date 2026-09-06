CREATE TABLE IF NOT EXISTS pedido_item_correcoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pedido_id INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  item_origem_id INTEGER NOT NULL,
  produto_origem_id INTEGER,
  produto_origem_nome TEXT NOT NULL,
  quantidade_origem INTEGER NOT NULL CHECK (quantidade_origem > 0),
  valor_origem_centavos INTEGER NOT NULL CHECK (valor_origem_centavos >= 0),
  item_destino_id INTEGER REFERENCES pedido_itens(id) ON DELETE SET NULL,
  produto_destino_id INTEGER,
  produto_destino_nome TEXT NOT NULL,
  quantidade_destino INTEGER NOT NULL CHECK (quantidade_destino > 0),
  valor_destino_centavos INTEGER NOT NULL CHECK (valor_destino_centavos >= 0),
  valor_realocado_centavos INTEGER NOT NULL CHECK (valor_realocado_centavos > 0),
  credito_gerado_centavos INTEGER NOT NULL DEFAULT 0 CHECK (credito_gerado_centavos >= 0),
  estoque_origem_reposto INTEGER NOT NULL DEFAULT 0 CHECK (estoque_origem_reposto IN (0, 1)),
  reserva_origem_liberada INTEGER NOT NULL DEFAULT 0 CHECK (reserva_origem_liberada IN (0, 1)),
  estoque_destino_baixado INTEGER NOT NULL DEFAULT 0 CHECK (estoque_destino_baixado IN (0, 1)),
  realizado_por_usuario_id INTEGER REFERENCES usuarios_admin(id) ON DELETE SET NULL,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pedido_item_correcoes_pedido
  ON pedido_item_correcoes(pedido_id, criado_em, id);
