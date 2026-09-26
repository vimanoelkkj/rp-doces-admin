-- Migration 0033: detalhes do produto no cardápio
--
-- Três campos de texto livre exibidos no card e no detalhe do produto:
--   peso_texto   — peso/porção como TEXTO ("220 g", "220 ml", "1 unidade",
--                  "aprox. 500 g"). Deliberadamente não numérico.
--   ingredientes — lista de ingredientes.
--   alergenicos  — alérgenos (opcional).
--
-- NOT NULL DEFAULT '' mantém os produtos existentes válidos sem backfill;
-- string vazia significa "não informado". Limites de tamanho são validados
-- na API administrativa.

ALTER TABLE produtos ADD COLUMN peso_texto TEXT NOT NULL DEFAULT '';
ALTER TABLE produtos ADD COLUMN ingredientes TEXT NOT NULL DEFAULT '';
ALTER TABLE produtos ADD COLUMN alergenicos TEXT NOT NULL DEFAULT '';
