-- B5 — Validação OBRIGATÓRIA após `scripts/b5-production-compat.sql`.
--
-- Somente leitura. É a autoridade sobre o resultado do upgrade: o script de
-- compatibilidade usa `IF NOT EXISTS` para ser reexecutável, e isso silencia
-- o caso "objeto já existe com schema divergente". Quem detecta esse caso é
-- esta validação, não o script.
--
-- Toda linha devolve `resultado = 'OK'` ou `'FALHA'`. Qualquer FALHA
-- significa que o banco NÃO está compatível com o rebuild — não prosseguir
-- com o deploy.
--
-- As últimas consultas devolvem contagens/somas para comparação manual com
-- os valores capturados ANTES da aplicação (o script não conhece o "antes",
-- e inventar um baseline embutido seria pior que compará-lo explicitamente).

-- ── 1. Tabela pedido_operacoes existe e tem as 18 colunas esperadas ──
SELECT 'pedido_operacoes: existe' AS verificacao,
       CASE WHEN EXISTS (SELECT 1 FROM sqlite_master
                         WHERE type='table' AND name='pedido_operacoes')
            THEN 'OK' ELSE 'FALHA' END AS resultado;

SELECT 'pedido_operacoes: 18 colunas' AS verificacao,
       CASE WHEN (SELECT COUNT(*) FROM pragma_table_info('pedido_operacoes')) = 18
            THEN 'OK' ELSE 'FALHA' END AS resultado;

-- Nomes exatos: detecta uma tabela homônima com estrutura divergente.
SELECT 'pedido_operacoes: colunas esperadas' AS verificacao,
       CASE WHEN (
         SELECT COUNT(*) FROM pragma_table_info('pedido_operacoes')
         WHERE name IN ('id','operation_key','tipo','escopo','ator_usuario_id',
                        'fingerprint_versao','fingerprint','fase','pedido_id',
                        'pagamento_id','reembolso_id','resultado','erro',
                        'mp_idempotency_key','mp_request','mp_payment_id',
                        'criado_em','atualizado_em')
       ) = 18 THEN 'OK' ELSE 'FALHA' END AS resultado;

-- Colunas que o A1 escreve sempre: precisam ser NOT NULL na ordem certa.
SELECT 'pedido_operacoes: NOT NULL obrigatorios' AS verificacao,
       CASE WHEN (
         SELECT COUNT(*) FROM pragma_table_info('pedido_operacoes')
         WHERE "notnull" = 1
           AND name IN ('operation_key','tipo','escopo','fingerprint_versao',
                        'fingerprint','fase','criado_em','atualizado_em')
       ) = 8 THEN 'OK' ELSE 'FALHA' END AS resultado;

-- ── 2. operation_key precisa ser UNIQUE: é o claim atômico do A1 ──
SELECT 'pedido_operacoes: operation_key UNIQUE' AS verificacao,
       CASE WHEN EXISTS (
         SELECT 1 FROM pragma_index_list('pedido_operacoes') il
         WHERE il."unique" = 1
           AND (SELECT group_concat(ii.name)
                FROM pragma_index_info(il.name) ii) = 'operation_key'
       ) THEN 'OK' ELSE 'FALHA' END AS resultado;

SELECT 'pedido_operacoes: indices de apoio' AS verificacao,
       CASE WHEN (SELECT COUNT(*) FROM sqlite_master
                  WHERE type='index'
                    AND name IN ('idx_pedido_operacoes_pedido',
                                 'idx_pedido_operacoes_fase')) = 2
            THEN 'OK' ELSE 'FALHA' END AS resultado;

-- ── 3. Índice de resolução do webhook ──
SELECT 'pedido_pagamentos: indice mp_payment_id' AS verificacao,
       CASE WHEN EXISTS (SELECT 1 FROM sqlite_master
                         WHERE type='index'
                           AND name='idx_pedido_pagamentos_mp_payment_id')
            THEN 'OK' ELSE 'FALHA' END AS resultado;

-- ── 4. Unicidade de pedidos.mp_payment_id ──
SELECT 'pedidos: mp_payment_id UNICO' AS verificacao,
       CASE WHEN EXISTS (
         SELECT 1 FROM pragma_index_list('pedidos') il
         WHERE il."unique" = 1
           AND (SELECT group_concat(ii.name)
                FROM pragma_index_info(il.name) ii) = 'mp_payment_id'
       ) THEN 'OK' ELSE 'FALHA' END AS resultado;

-- Confirma que a garantia é real nos dados, não só no catálogo.
SELECT 'pedidos: zero duplicatas mp_payment_id' AS verificacao,
       CASE WHEN (SELECT COUNT(*) FROM (
                    SELECT mp_payment_id FROM pedidos
                    WHERE mp_payment_id IS NOT NULL
                    GROUP BY mp_payment_id HAVING COUNT(*) > 1)) = 0
            THEN 'OK' ELSE 'FALHA' END AS resultado;

-- ── 5. Nada histórico foi endurecido ou perdido ──
SELECT 'pedidos: colunas legadas preservadas' AS verificacao,
       CASE WHEN (
         SELECT COUNT(*) FROM pragma_table_info('pedidos')
         WHERE name IN ('produto_nome','quantidade','valor_unitario_centavos','cliente_email')
       ) = 4 THEN 'OK' ELSE 'FALHA' END AS resultado;

SELECT 'integridade: foreign_key_check' AS verificacao,
       CASE WHEN (SELECT COUNT(*) FROM pragma_foreign_key_check) = 0
            THEN 'OK' ELSE 'FALHA' END AS resultado;

SELECT 'pedidos: total bate com a soma dos itens' AS verificacao,
       CASE WHEN (SELECT COUNT(*) FROM pedidos p
                  WHERE p.valor_total_centavos <> (
                    SELECT COALESCE(SUM(i.valor_total_centavos), 0)
                    FROM pedido_itens i WHERE i.pedido_id = p.id)) = 0
            THEN 'OK' ELSE 'FALHA' END AS resultado;

SELECT 'produtos: CHECK de estoque_reservado respeitado' AS verificacao,
       CASE WHEN (SELECT COUNT(*) FROM produtos
                  WHERE estoque_reservado > estoque OR estoque_reservado < 0) = 0
            THEN 'OK' ELSE 'FALHA' END AS resultado;

-- ── 6. Fotografia para comparar com o "antes" capturado manualmente ──
SELECT 'contagens' AS verificacao,
       (SELECT COUNT(*) FROM produtos) AS produtos,
       (SELECT COUNT(*) FROM categorias) AS categorias,
       (SELECT COUNT(*) FROM pedidos) AS pedidos,
       (SELECT COUNT(*) FROM pedido_itens) AS itens,
       (SELECT COUNT(*) FROM pedido_pagamentos) AS pagamentos,
       (SELECT COUNT(*) FROM pedido_pagamento_alocacoes) AS alocacoes,
       (SELECT COUNT(*) FROM pedido_reembolsos) AS reembolsos,
       (SELECT COUNT(*) FROM usuarios_admin) AS admins;

SELECT 'somas' AS verificacao,
       (SELECT COALESCE(SUM(estoque), 0) FROM produtos) AS estoque_total,
       (SELECT COALESCE(SUM(estoque_reservado), 0) FROM produtos) AS reservado_total,
       (SELECT COALESCE(SUM(valor_centavos), 0) FROM pedido_pagamentos
        WHERE status = 'PAGO') AS pago_centavos,
       (SELECT COALESCE(SUM(valor_total_centavos), 0) FROM pedidos) AS pedidos_centavos,
       (SELECT COALESCE(MAX(id), 0) FROM pedidos) AS max_pedido_id,
       (SELECT COALESCE(MAX(id), 0) FROM pedido_pagamentos) AS max_pagamento_id;
