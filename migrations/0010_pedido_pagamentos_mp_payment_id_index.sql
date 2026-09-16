-- Passo 6: índice de apoio para a resolução direta do webhook do Mercado
-- Pago (busca por pedido_pagamentos.mp_payment_id). Sem UNIQUE: diferente
-- de mp_order_id (herdado do DDL de produção e não usado por nós, que
-- seguimos na Payments API), mp_payment_id aqui pode legitimamente repetir
-- NULL em muitas linhas antes da confirmação do Mercado Pago.
CREATE INDEX idx_pedido_pagamentos_mp_payment_id
  ON pedido_pagamentos(mp_payment_id)
  WHERE mp_payment_id IS NOT NULL;
