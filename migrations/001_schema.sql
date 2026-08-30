-- Base schema for fresh/local databases.
-- Later migrations evolve this table incrementally.
CREATE TABLE IF NOT EXISTS produtos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  categoria TEXT NOT NULL CHECK (categoria IN ('BOLO_NO_POTE', 'MINI_PUDIM')),
  descricao TEXT NOT NULL DEFAULT '',
  preco_centavos INTEGER NOT NULL CHECK (preco_centavos >= 1),
  disponivel INTEGER NOT NULL DEFAULT 1 CHECK (disponivel IN (0,1)),
  ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0,1)),
  destaque INTEGER NOT NULL DEFAULT 0 CHECK (destaque IN (0,1)),
  ordem INTEGER NOT NULL DEFAULT 0,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_produtos_categoria_ordem
ON produtos(categoria, ordem, nome);

CREATE INDEX IF NOT EXISTS idx_produtos_ativo_disponivel
ON produtos(ativo, disponivel);
