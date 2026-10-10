-- Migration 0039: Índice parcial das capturas Pix confirmadas e ainda não conciliadas (F1).
--
-- A lista de pedidos do admin inclui o Pix que o Mercado Pago já confirmou (ou devolveu) e o
-- ledger ainda não aceitou (`capturaRemotaNaoConciliadaSql`, functions/lib/pedidoFinanceiroSql.ts).
-- Esse predicado entra como EXISTS por pedido na contagem, na página e nos contadores das abas.
-- Sem este índice, cada carrinho lido custa a busca em (pedido_id, status, criado_em) mais a
-- linha de `pedido_pagamentos`: com 20 mil pedidos, `counts` lê ~188 mil linhas contra 20 mil.
--
-- O índice guarda só as poucas linhas que satisfazem o predicado; a sondagem de um carrinho
-- comum não lê nada. A cláusula WHERE precisa continuar idêntica à do helper para o SQLite
-- poder usar o índice; tests/mp-integrity-visibility.test.mjs trava esse acoplamento.
--
-- Migration puramente ADITIVA: nenhuma tabela é alterada ou recriada; ledger, estoque e
-- reembolsos ficam intactos. Sem o índice o resultado é o mesmo, apenas mais lento.

CREATE INDEX IF NOT EXISTS idx_pedido_pagamentos_captura_nao_conciliada
  ON pedido_pagamentos(pedido_id)
  WHERE metodo = 'PIX_MP' AND status NOT IN ('PAGO', 'REEMBOLSADO')
    AND LOWER(COALESCE(mp_status, '')) IN ('approved', 'refunded');
