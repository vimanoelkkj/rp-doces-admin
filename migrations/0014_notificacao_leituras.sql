-- HUMAN-14: estado de LEITURA das notificações do admin.
--
-- Migration aditiva, para ambientes novos/rebuild. NÃO deve ser aplicada à
-- produção histórica pelo fluxo normal de migrations: a adaptação da produção
-- será tratada em fase própria, com script aditivo e autorização explícita,
-- na mesma cautela do B5.
--
-- POR QUE ESTA TABELA EXISTE, E SÓ ELA:
--
-- As notificações em si NÃO são materializadas. Cada uma é DERIVADA, na
-- leitura, de fatos que já existem no domínio (pedido novo, pagamento
-- confirmado, estoque no limite, operação com envio inconclusivo). Duplicar
-- esses fatos numa tabela de notificações criaria uma segunda verdade que
-- poderia divergir do ledger/estoque — exatamente o que o projeto evita.
--
-- O que NÃO é derivável é "este operador já viu este evento". Só isso é
-- persistido aqui.
--
-- Deliberadamente SEM FK para `pedidos`/`produtos`: a notificação é
-- identificada por `chave` (string estável derivada do fato), e a tabela
-- guarda apenas estado de leitura. Uma FK existiria só para limpeza, e isso
-- não justifica acoplar a tabela ao domínio. Se o fato de origem desaparecer,
-- a chave simplesmente deixa de ser derivada e a linha vira inerte.
--
-- A única FK é a do dono da leitura: se o administrador é removido, as
-- leituras dele não têm mais significado.

CREATE TABLE notificacao_leituras (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER NOT NULL,
  chave TEXT NOT NULL,
  lida_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (usuario_id) REFERENCES usuarios_admin(id) ON DELETE CASCADE
);

-- Marcar como lida é at-most-once e idempotente: o writer usa
-- `INSERT OR IGNORE`, então marcar duas vezes (retry, dois cliques, duas
-- abas) nunca produz uma segunda linha nem um erro.
CREATE UNIQUE INDEX uq_notificacao_leituras_usuario_chave
  ON notificacao_leituras(usuario_id, chave);

-- Varredura das leituras de um operador (badge e lista).
CREATE INDEX idx_notificacao_leituras_usuario
  ON notificacao_leituras(usuario_id, lida_em);
