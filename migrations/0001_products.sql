CREATE TABLE produtos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  categoria TEXT NOT NULL,
  descricao TEXT NOT NULL DEFAULT '',
  preco_centavos INTEGER NOT NULL CHECK (preco_centavos >= 1),
  preco_promocional_centavos INTEGER,
  promocao_inicio TEXT,
  promocao_fim TEXT,
  disponivel INTEGER NOT NULL DEFAULT 1 CHECK (disponivel IN (0, 1)),
  destaque INTEGER NOT NULL DEFAULT 0 CHECK (destaque IN (0, 1)),
  ordem INTEGER NOT NULL DEFAULT 0,
  estoque INTEGER NOT NULL DEFAULT 0 CHECK (estoque >= 0),
  estoque_reservado INTEGER NOT NULL DEFAULT 0
    CHECK (estoque_reservado >= 0 AND estoque_reservado <= estoque),
  image_key TEXT,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_produtos_categoria_ordem ON produtos(categoria, ordem, nome);
CREATE INDEX idx_produtos_ativo_disponivel ON produtos(disponivel);
