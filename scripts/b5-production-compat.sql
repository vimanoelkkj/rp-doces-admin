-- B5 — Script de compatibilidade do D1 HISTÓRICO de produção.
--
-- ESTE ARQUIVO NÃO É UMA MIGRATION E NUNCA DEVE SER EXECUTADO PELO FLUXO
-- NORMAL `wrangler d1 migrations apply`. Ele vive fora de `migrations/`
-- justamente para isso.
--
-- POR QUE ELE EXISTE
--
-- `migrations/0001..0012` descrevem como construir um banco NOVO do zero.
-- O D1 de produção não foi construído por elas: ele tem 36 migrations
-- próprias (`001_schema.sql` … `036_reembolsos_parciais.sql`) e nenhuma das
-- do rebuild consta em `d1_migrations`. Rodar `migrations apply --remote`
-- aplicaria as doze, incluindo os `DROP TABLE` de `pedidos`/`pedido_itens`
-- das migrations 0006/0007/0008 — que cascateiam para itens, ledger,
-- alocações e reembolsos. Seria destruição de histórico, não upgrade.
--
-- A auditoria B5 Fase 1 (read-only) mostrou que produção já satisfaz quase
-- todo o schema alvo: 10 das 11 tabelas do rebuild existem, e `pedido_itens`,
-- `pedido_pagamentos`, `pedido_pagamento_alocacoes` e `pedido_reembolsos`
-- têm DDL equivalente. O que falta é pequeno e ADITIVO — é o que está aqui.
--
-- GARANTIAS DESTE SCRIPT
--
--   * nenhum DROP, nenhum ALTER, nenhum DELETE, nenhum UPDATE;
--   * nenhuma tabela existente é reconstruída, copiada ou renomeada;
--   * nenhuma linha histórica é lida para decisão nem reescrita;
--   * só cria objetos que hoje NÃO existem em produção.
--
-- IDEMPOTÊNCIA
--
-- Os `IF NOT EXISTS` existem para tornar a reexecução segura, NÃO para
-- mascarar incompatibilidade. São duas redes independentes:
--
--   1. o próprio script falha se houver uma `pedido_operacoes` homônima com
--      estrutura divergente — o `CREATE TABLE IF NOT EXISTS` silencia, mas os
--      `CREATE INDEX` seguintes referenciam colunas que não existiriam e
--      quebram na hora (verificado em teste);
--   2. `scripts/b5-production-validate.sql` confere o schema resultante
--      coluna a coluna e é a autoridade final.
--
-- Sempre rodar a validação depois. Um script que "passou" não é prova.
--
-- COMO APLICAR (Fase 3, somente depois de backup + ensaio em clone):
--   npx wrangler d1 execute <banco> --file=scripts/b5-production-compat.sql
--   npx wrangler d1 execute <banco> --file=scripts/b5-production-validate.sql
--
-- O que este script deliberadamente NÃO faz:
--   * não toca `d1_migrations` (não marca 0001..0012 como aplicadas);
--   * não altera a tabela `pedidos` — as colunas legadas obrigatórias
--     (`produto_nome`, `quantidade`, `valor_unitario_centavos`,
--     `cliente_email`) continuam como estão, e é o CÓDIGO do rebuild que
--     passou a preenchê-las;
--   * não corrige o pedido histórico com `reserva_status='ATIVA'` e
--     `estoque_baixado_em NULL` — dado histórico não se reescreve por
--     conveniência de schema.

-- ───────────────────────────────────────────────────────────────────────
-- 1) pedido_operacoes — identidade lógica das operações (A1).
--    Única tabela de domínio do rebuild ausente em produção. DDL idêntico
--    ao de `migrations/0012_operacoes_idempotencia.sql`.
-- ───────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pedido_operacoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  operation_key TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN (
    'CHECKOUT_SITE',
    'PEDIDO_ADMIN',
    'PAGAMENTO_ADMIN',
    'REFUND_ADMIN',
    'PIX_ADMIN',
    'PIX_ADMIN_REGENERACAO'
  )),
  escopo TEXT NOT NULL CHECK (escopo IN ('SITE', 'ADMIN')),
  ator_usuario_id INTEGER,
  fingerprint_versao INTEGER NOT NULL,
  fingerprint TEXT NOT NULL,
  fase TEXT NOT NULL DEFAULT 'LOCAL_CRIADA' CHECK (fase IN (
    'LOCAL_CRIADA',
    'ENVIO_INCONCLUSIVO',
    'REMOTO_CONHECIDO',
    'CONCLUIDA',
    'RECUSADA'
  )),
  pedido_id INTEGER,
  pagamento_id INTEGER,
  reembolso_id INTEGER,
  resultado TEXT,
  erro TEXT,
  mp_idempotency_key TEXT,
  mp_request TEXT,
  mp_payment_id TEXT,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE CASCADE,
  FOREIGN KEY (pagamento_id) REFERENCES pedido_pagamentos(id) ON DELETE SET NULL,
  FOREIGN KEY (reembolso_id) REFERENCES pedido_reembolsos(id) ON DELETE SET NULL,
  FOREIGN KEY (ator_usuario_id) REFERENCES usuarios_admin(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pedido_operacoes_key
  ON pedido_operacoes(operation_key);
CREATE INDEX IF NOT EXISTS idx_pedido_operacoes_pedido
  ON pedido_operacoes(pedido_id, criado_em);
CREATE INDEX IF NOT EXISTS idx_pedido_operacoes_fase
  ON pedido_operacoes(fase, atualizado_em);

-- ───────────────────────────────────────────────────────────────────────
-- 2) Índice de resolução do webhook por `pedido_pagamentos.mp_payment_id`.
--    Mesmo nome e mesma definição de `migrations/0010`. Sem UNIQUE, por
--    decisão já documentada do rebuild: a coluna repete NULL livremente e
--    todos os leitores falham em segurança diante de divergência.
-- ───────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_pedido_pagamentos_mp_payment_id
  ON pedido_pagamentos(mp_payment_id)
  WHERE mp_payment_id IS NOT NULL;

-- ───────────────────────────────────────────────────────────────────────
-- 3) Unicidade de `pedidos.mp_payment_id`.
--
--    Num banco criado pelas migrations do rebuild, essa garantia vem da
--    constraint de coluna (`mp_payment_id TEXT UNIQUE`, migrations 0002/
--    0006/0008). O `pedidos` histórico de produção nasceu sem ela, e
--    adicioná-la como constraint exigiria reconstruir a tabela — proibido.
--
--    Um índice único PARCIAL entrega a mesma garantia sem tocar a tabela:
--    o SQLite já permite múltiplos NULL num UNIQUE, então `WHERE
--    mp_payment_id IS NOT NULL` é equivalente na prática e deixa explícito
--    que tentativas sem id remoto não competem entre si.
--
--    Nome deliberadamente distinto de `idx_pedidos_mp_payment_id` (índice
--    COMUM que as migrations do rebuild criam): dois objetos com o mesmo
--    nome e semânticas diferentes seria uma armadilha. O prefixo `uq_`
--    segue o padrão já usado no repositório (`uq_pedido_pagamentos_mp_order`,
--    `uq_pedido_pagamentos_idempotency`, `uq_pedido_reembolsos_idempotency`).
--
--    A auditoria Fase 1 confirmou ZERO duplicatas não-nulas hoje. Se alguma
--    existir no momento da aplicação, este comando FALHA e o script inteiro
--    para — fail-closed de propósito. Nada é apagado, nenhum "vencedor" é
--    escolhido, nenhum dado é corrigido automaticamente. Resolver
--    duplicatas históricas é decisão humana, não efeito colateral.
-- ───────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_pedidos_mp_payment_id
  ON pedidos(mp_payment_id)
  WHERE mp_payment_id IS NOT NULL;
