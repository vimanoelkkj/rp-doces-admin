-- Passo 7: índice de apoio para a varredura oportunista de reservas
-- vencidas (liberarReservasVencidasLocalmente), idêntico ao de produção.
CREATE INDEX idx_pedidos_reserva_ativa
  ON pedidos(reserva_expira_em)
  WHERE status_pagamento = 'PENDENTE' AND reserva_status = 'ATIVA';
