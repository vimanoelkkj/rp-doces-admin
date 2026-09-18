-- B5 — Alinha o banco NOVO com as colunas legadas que o `pedidos` histórico
-- de produção exige.
--
-- O PROBLEMA QUE ISTO RESOLVE
--
-- O D1 de produção nasceu no modelo "um produto por pedido" e ainda carrega
-- quatro colunas obrigatórias que os INSERTs do rebuild não preenchiam:
--
--   produto_nome              TEXT    NOT NULL   (sem DEFAULT)
--   quantidade                INTEGER NOT NULL   (sem DEFAULT, CHECK 1..50)
--   valor_unitario_centavos   INTEGER NOT NULL   (sem DEFAULT, CHECK >= 0)
--   cliente_email             TEXT    NOT NULL   (sem DEFAULT)
--
-- Destas, `cliente_email` JÁ existe no banco novo (as migrations 0006/0008 a
-- recriam com `DEFAULT ''`), então só as três primeiras são adicionadas aqui.
-- O INSERT do rebuild passa as quatro explicitamente: em produção elas são
-- obrigatórias, e no banco novo um valor explícito é igualmente aceito.
--
-- Os dois caminhos de criação de pedido do rebuild (checkout do site e
-- pedido manual do admin) não as preenchiam, então ambos falhariam em
-- produção com `NOT NULL constraint failed` já no primeiro pedido real.
--
-- A correção é preencher essas colunas no INSERT. Mas um INSERT estático
-- que as cite quebraria o banco NOVO, onde elas não existem — daí esta
-- migration: o banco novo passa a ter as MESMAS colunas, com DEFAULT, e um
-- único INSERT serve aos dois mundos sem código condicional.
--
-- Produção NÃO recebe esta migration (e não precisa: lá as colunas já
-- existem). O upgrade de produção é `scripts/b5-production-compat.sql`, que
-- deliberadamente não toca a tabela `pedidos`.
--
-- SEMÂNTICA: estas colunas são COMPATIBILIDADE ESTRUTURAL, não fonte de
-- verdade. A verdade do pedido continua sendo `pedido_itens` (composição) e
-- `pedidos.valor_total_centavos` (total). Nenhum código do rebuild lê estas
-- quatro colunas — conferido: todas as leituras de `produto_nome`,
-- `quantidade` e `valor_unitario_centavos` vêm de `pedido_itens`, e
-- `cliente_email` não é referenciado em lugar nenhum.
--
-- Os DEFAULTs espelham os valores neutros gravados pelo código. `quantidade`
-- é 1, e não 0, porque o CHECK de produção exige `>= 1`: é o menor valor
-- legal, escolhido para não afirmar quantidade nenhuma. Somar as quantidades
-- reais dos itens seria pior — além de fabricar semântica, estouraria o
-- CHECK `<= 50` em pedidos grandes.
--
-- Os CHECKs são replicados de produção de propósito: assim o ambiente local
-- rejeita exatamente o que produção rejeitaria, em vez de aceitar valores
-- que só quebrariam no cutover.

ALTER TABLE pedidos ADD COLUMN produto_nome TEXT NOT NULL DEFAULT '';
ALTER TABLE pedidos ADD COLUMN quantidade INTEGER NOT NULL DEFAULT 1
  CHECK (quantidade >= 1 AND quantidade <= 50);
ALTER TABLE pedidos ADD COLUMN valor_unitario_centavos INTEGER NOT NULL DEFAULT 0
  CHECK (valor_unitario_centavos >= 0);
