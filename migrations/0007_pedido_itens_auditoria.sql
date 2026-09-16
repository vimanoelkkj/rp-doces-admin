-- Adiciona os metadados de estoque/auditoria que faltavam em pedido_itens
-- (mesmo padrão seguro create __novo/copy/drop/rename das migrations
-- anteriores). Nenhuma linha é perdida.
--
-- adicionado_por_usuario_id / adicionado_em ficam NULL para todo item
-- existente: não temos evidência de que algum desses itens foi incluído
-- depois por um admin (o endpoint atual de edição substitui a lista
-- inteira, não adiciona item a item), então NULL é o valor correto, não um
-- dado faltando. criado_em é herdado de pedidos.criado_em do pedido pai —
-- o melhor timestamp histórico real disponível, sem fingir precisão que
-- não temos.

PRAGMA defer_foreign_keys = ON;

CREATE TABLE pedido_itens__novo (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pedido_id INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  produto_id INTEGER REFERENCES produtos(id) ON DELETE SET NULL,
  produto_nome TEXT NOT NULL,
  quantidade INTEGER NOT NULL CHECK (quantidade >= 1 AND quantidade <= 50),
  valor_unitario_centavos INTEGER NOT NULL CHECK (valor_unitario_centavos >= 0),
  valor_total_centavos INTEGER NOT NULL CHECK (valor_total_centavos >= 0),
  estoque_baixado_em TEXT,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  adicionado_por_usuario_id INTEGER REFERENCES usuarios_admin(id) ON DELETE SET NULL,
  adicionado_em TEXT
);

INSERT INTO pedido_itens__novo (
  id, pedido_id, produto_id, produto_nome, quantidade,
  valor_unitario_centavos, valor_total_centavos,
  estoque_baixado_em, criado_em, adicionado_por_usuario_id, adicionado_em
)
SELECT
  pi.id, pi.pedido_id, pi.produto_id, pi.produto_nome, pi.quantidade,
  pi.valor_unitario_centavos, pi.valor_total_centavos,
  NULL, COALESCE(p.criado_em, CURRENT_TIMESTAMP), NULL, NULL
FROM pedido_itens pi
LEFT JOIN pedidos p ON p.id = pi.pedido_id;

DROP TABLE pedido_itens;
ALTER TABLE pedido_itens__novo RENAME TO pedido_itens;

CREATE INDEX idx_pedido_itens_pedido ON pedido_itens(pedido_id);
CREATE INDEX idx_pedido_itens_produto ON pedido_itens(produto_id);
CREATE INDEX idx_pedido_itens_estoque ON pedido_itens(pedido_id, estoque_baixado_em);
CREATE INDEX idx_pedido_itens_adicionado_por ON pedido_itens(pedido_id, adicionado_por_usuario_id, id);

PRAGMA defer_foreign_keys = OFF;
