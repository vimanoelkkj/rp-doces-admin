CREATE TABLE IF NOT EXISTS categorias (
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

CREATE INDEX IF NOT EXISTS idx_categorias_ativo_ordem
  ON categorias (ativo, ordem, nome);

INSERT OR IGNORE INTO categorias (id, nome, emoji, descricao, ordem, ativo, sistema)
VALUES
  ('BOLO_NO_POTE', 'Bolos no pote', '🍰', 'Bolos no pote do cardápio R&P Doces.', 0, 1, 1),
  ('MINI_PUDIM', 'Mini pudins', '🍮', 'Mini pudins do cardápio R&P Doces.', 1, 1, 1);
