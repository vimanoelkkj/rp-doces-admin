-- 0014 — Validação READ-ONLY após scripts/0014-production-compat.sql.
--
-- Toda verificação estrutural deve retornar resultado='OK'.
-- Qualquer FALHA bloqueia o deploy.
--
-- Este script não escreve nada.

SELECT 'notificacao_leituras: existe' AS verificacao,
       CASE WHEN EXISTS (
         SELECT 1 FROM sqlite_master
         WHERE type='table' AND name='notificacao_leituras'
       ) THEN 'OK' ELSE 'FALHA' END AS resultado;

SELECT 'notificacao_leituras: 4 colunas' AS verificacao,
       CASE WHEN (
         SELECT COUNT(*) FROM pragma_table_info('notificacao_leituras')
       ) = 4 THEN 'OK' ELSE 'FALHA' END AS resultado;

SELECT 'notificacao_leituras: colunas esperadas' AS verificacao,
       CASE WHEN (
         SELECT COUNT(*) FROM pragma_table_info('notificacao_leituras')
         WHERE name IN ('id','usuario_id','chave','lida_em')
       ) = 4 THEN 'OK' ELSE 'FALHA' END AS resultado;

SELECT 'notificacao_leituras: NOT NULL obrigatorios' AS verificacao,
       CASE WHEN (
         SELECT COUNT(*) FROM pragma_table_info('notificacao_leituras')
         WHERE "notnull" = 1
           AND name IN ('usuario_id','chave','lida_em')
       ) = 3 THEN 'OK' ELSE 'FALHA' END AS resultado;

SELECT 'notificacao_leituras: UNIQUE usuario/chave' AS verificacao,
       CASE WHEN EXISTS (
         SELECT 1
         FROM pragma_index_list('notificacao_leituras') il
         WHERE il."unique" = 1
           AND (
             SELECT group_concat(ii.name, ',')
             FROM pragma_index_info(il.name) ii
           ) = 'usuario_id,chave'
       ) THEN 'OK' ELSE 'FALHA' END AS resultado;

SELECT 'notificacao_leituras: indice de leitura por usuario' AS verificacao,
       CASE WHEN EXISTS (
         SELECT 1
         FROM pragma_index_list('notificacao_leituras') il
         WHERE (
           SELECT group_concat(ii.name, ',')
           FROM pragma_index_info(il.name) ii
         ) = 'usuario_id,lida_em'
       ) THEN 'OK' ELSE 'FALHA' END AS resultado;

SELECT 'notificacao_leituras: FK usuario CASCADE' AS verificacao,
       CASE WHEN EXISTS (
         SELECT 1
         FROM pragma_foreign_key_list('notificacao_leituras')
         WHERE "table" = 'usuarios_admin'
           AND "from" = 'usuario_id'
           AND "to" = 'id'
           AND upper(on_delete) = 'CASCADE'
       ) THEN 'OK' ELSE 'FALHA' END AS resultado;

SELECT 'notificacao_leituras: foreign_key_check' AS verificacao,
       CASE WHEN (
         SELECT COUNT(*) FROM pragma_foreign_key_check('notificacao_leituras')
       ) = 0 THEN 'OK' ELSE 'FALHA' END AS resultado;

SELECT 'notificacao_leituras: linhas atuais' AS verificacao,
       COUNT(*) AS linhas
FROM notificacao_leituras;
