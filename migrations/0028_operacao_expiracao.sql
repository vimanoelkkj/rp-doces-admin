-- R2: fechamento seguro de operações PIX cujo envio ao Mercado Pago ficou
-- INCONCLUSIVO e cuja busca por external_reference nunca encontrou pagamento.
--
-- Migration puramente ADITIVA: nenhuma tabela é reconstruída, nenhum dado é
-- reescrito. `expirado_em` marca a operação que atingiu o prazo terminal
-- (date_of_expiration persistida no mp_request + 24h de margem) com busca
-- NENHUM — e a remove da seleção de inconclusivas, sem alterar a fase nem
-- inventar rejeição. Um evento tardio do provedor (webhook assinado) ainda
-- promove EXPIRADO -> PAGO pelo caminho verificado do B2.

ALTER TABLE pedido_operacoes ADD COLUMN expirado_em TEXT;
