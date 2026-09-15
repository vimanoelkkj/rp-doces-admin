CREATE TABLE categorias (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  emoji TEXT NOT NULL DEFAULT '🍰',
  descricao TEXT NOT NULL DEFAULT '',
  ordem INTEGER NOT NULL DEFAULT 0,
  ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
  sistema INTEGER NOT NULL DEFAULT 0 CHECK (sistema IN (0, 1)),
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_categorias_ativo_ordem ON categorias (ativo, ordem, nome);

-- Uma categoria de sistema por valor distinto já usado em produtos.categoria
-- hoje, no mesmo padrão de identificador (slug maiúsculo) usado em produção.
INSERT OR IGNORE INTO categorias (id, nome, sistema)
SELECT DISTINCT
  UPPER(REPLACE(REPLACE(TRIM(categoria), ' ', '_'), '-', '_')),
  TRIM(categoria),
  1
FROM produtos
WHERE TRIM(categoria) <> '';

-- Normaliza produtos.categoria para referenciar o id/slug da categoria,
-- em vez do texto livre digitado originalmente.
UPDATE produtos
SET categoria = UPPER(REPLACE(REPLACE(TRIM(categoria), ' ', '_'), '-', '_'))
WHERE TRIM(categoria) <> '';

ALTER TABLE produtos ADD COLUMN promocao_ativa INTEGER NOT NULL DEFAULT 0;

DROP INDEX idx_produtos_ativo_disponivel;
CREATE INDEX idx_produtos_ativo_disponivel ON produtos(ativo, disponivel);
