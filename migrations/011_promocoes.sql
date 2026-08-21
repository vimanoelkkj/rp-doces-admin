ALTER TABLE produtos ADD COLUMN promocao_ativa INTEGER NOT NULL DEFAULT 0;
ALTER TABLE produtos ADD COLUMN preco_promocional_centavos INTEGER;
ALTER TABLE produtos ADD COLUMN promocao_inicio TEXT;
ALTER TABLE produtos ADD COLUMN promocao_fim TEXT;
