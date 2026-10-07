-- Migration 0038: Estabilização de expiração do Pix de diagnóstico permanente.
--
-- Armazena a expiração e o payload calculados por operation_key para garantir
-- idempotência estrita no envio à Orders API do Mercado Pago (evitando HTTP 409
-- por date_of_expiration divergente entre retries da mesma operação lógica).
--
-- Migration puramente ADITIVA: nenhuma tabela existente é alterada ou recriada.
-- Deliberadamente isolada de `pedidos`, `pedido_pagamentos`, `pedido_itens`,
-- `produtos` e `pedido_operacoes` para preservar integralmente o isolamento
-- de domínio e métricas de vendas.

CREATE TABLE IF NOT EXISTS admin_diagnostico_pix (
  operation_key TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL,
  mp_request TEXT,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
