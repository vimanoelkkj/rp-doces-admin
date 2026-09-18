-- Diagnósticos permanentes do Admin > Loja — "Pedido de produto de teste".
--
-- Toda notificação do HUMAN-14 é DERIVADA de um fato real de domínio
-- (pedido, pagamento, estoque, operação) — nunca materializada. O botão de
-- diagnóstico precisa gerar uma notificação SEM criar pedido, pagamento ou
-- baixa de estoque reais. Em vez de abrir uma exceção na regra ("essa
-- notificação não vem de fato nenhum"), esta tabela registra o PRÓPRIO fato
-- isolado — "um operador disparou um teste operacional" — e a notificação
-- continua sendo derivada normalmente dele, como as demais.
--
-- Deliberadamente SEM qualquer relação com `pedidos`, `pedido_pagamentos`,
-- `pedido_itens` ou `produtos`: não é um pedido fictício, é um evento de
-- diagnóstico à parte. Isso é o que garante, por construção, que o teste
-- nunca aparece na listagem de pedidos, nunca altera estoque e nunca entra
-- nas métricas do Dashboard — essas telas não têm como enxergar esta tabela.

CREATE TABLE admin_diagnostico_eventos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL CHECK (tipo IN ('PEDIDO_TESTE')),
  usuario_id INTEGER,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (usuario_id) REFERENCES usuarios_admin(id) ON DELETE SET NULL
);

CREATE INDEX idx_admin_diagnostico_eventos_tipo ON admin_diagnostico_eventos(tipo, criado_em);
