-- Remove a restrição histórica que limitava produtos a apenas duas categorias.
-- A validade da categoria passa a ser garantida pela tabela `categorias` e pela API.

PRAGMA defer_foreign_keys = ON;

CREATE TABLE produtos__novo (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  categoria TEXT NOT NULL,
  descricao TEXT NOT NULL DEFAULT '',
  preco_centavos INTEGER NOT NULL CHECK (preco_centavos >= 1),
  disponivel INTEGER NOT NULL DEFAULT 1 CHECK (disponivel IN (0, 1)),
  ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
  destaque INTEGER NOT NULL DEFAULT 0 CHECK (destaque IN (0, 1)),
  ordem INTEGER NOT NULL DEFAULT 0,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  emoji TEXT NOT NULL DEFAULT '',
  estoque INTEGER NOT NULL DEFAULT 0 CHECK (estoque >= 0),
  promocao_ativa INTEGER NOT NULL DEFAULT 0,
  preco_promocional_centavos INTEGER,
  promocao_inicio TEXT,
  promocao_fim TEXT,
  estoque_reservado INTEGER NOT NULL DEFAULT 0
    CHECK (estoque_reservado >= 0 AND estoque_reservado <= estoque)
);

INSERT INTO produtos__novo (
  id,
  nome,
  categoria,
  descricao,
  preco_centavos,
  disponivel,
  ativo,
  destaque,
  ordem,
  criado_em,
  atualizado_em,
  emoji,
  estoque,
  promocao_ativa,
  preco_promocional_centavos,
  promocao_inicio,
  promocao_fim,
  estoque_reservado
)
SELECT
  id,
  nome,
  categoria,
  descricao,
  preco_centavos,
  disponivel,
  ativo,
  destaque,
  ordem,
  criado_em,
  atualizado_em,
  emoji,
  estoque,
  promocao_ativa,
  preco_promocional_centavos,
  promocao_inicio,
  promocao_fim,
  estoque_reservado
FROM produtos;

DROP TABLE produtos;
ALTER TABLE produtos__novo RENAME TO produtos;

CREATE INDEX IF NOT EXISTS idx_produtos_categoria_ordem
  ON produtos(categoria, ordem, nome);

CREATE INDEX IF NOT EXISTS idx_produtos_ativo_disponivel
  ON produtos(ativo, disponivel);

PRAGMA defer_foreign_keys = OFF;
