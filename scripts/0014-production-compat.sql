-- 0014 — Compatibilidade ADITIVA para o D1 HISTÓRICO de produção.
--
-- NÃO é uma migration normal do rebuild e NÃO deve ser executada com
-- `wrangler d1 migrations apply --remote`.
--
-- Produção já passou pelo cutover B5 e não usa a cadeia 0001..0014 do rebuild.
-- Este script aplica SOMENTE o objeto novo exigido pelo HUMAN-14:
-- `notificacao_leituras`, sem tocar dados ou tabelas de domínio existentes.
--
-- Garantias:
--   * nenhum DROP, ALTER, UPDATE, DELETE ou INSERT de dado de domínio;
--   * não toca `d1_migrations`;
--   * idempotente por `IF NOT EXISTS`;
--   * rollback estrutural possível removendo apenas esta tabela, perdendo
--     somente estado de leitura de notificações, nunca fatos do domínio.
--
-- Aplicação autorizada:
--   npx wrangler d1 execute rp-doces-db --remote \
--     --file=scripts/0014-production-compat.sql
--
-- Depois, executar OBRIGATORIAMENTE:
--   npx wrangler d1 execute rp-doces-db --remote \
--     --file=scripts/0014-production-validate.sql
--
-- Não prosseguir com deploy se qualquer validação retornar FALHA.

CREATE TABLE IF NOT EXISTS notificacao_leituras (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER NOT NULL,
  chave TEXT NOT NULL,
  lida_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (usuario_id) REFERENCES usuarios_admin(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_notificacao_leituras_usuario_chave
  ON notificacao_leituras(usuario_id, chave);

CREATE INDEX IF NOT EXISTS idx_notificacao_leituras_usuario
  ON notificacao_leituras(usuario_id, lida_em);
