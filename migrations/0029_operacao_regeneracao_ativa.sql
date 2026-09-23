-- R3: índice parcial único para serializar operações ativas de regeneração
-- Pix sobre o mesmo pagamento predecessor (A), impedindo TOCTOU com operationKeys diferentes.

CREATE UNIQUE INDEX uq_pedido_operacoes_regeneracao_ativa
ON pedido_operacoes(pagamento_id)
WHERE tipo = 'PIX_ADMIN_REGENERACAO'
  AND fase IN ('LOCAL_CRIADA', 'ENVIO_INCONCLUSIVO', 'REMOTO_CONHECIDO')
  AND expirado_em IS NULL;
