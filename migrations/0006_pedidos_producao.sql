-- Reconstrução segura de `pedidos` (mesmo padrão de produção nas migrations
-- 013/022: create __novo / copy com remap / drop / rename), para adotar o
-- schema real de produção como fonte da verdade. Nenhuma linha é perdida.
--
-- Também renomeia `recado` -> `observacao`, decisão já registrada na matriz
-- de comparação do Passo 1 (tabela 3) mas não restated explicitamente no
-- plano do Passo 2 — sinalizado no relatório do commit.

PRAGMA defer_foreign_keys = ON;

CREATE TABLE pedidos__novo (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_publico TEXT NOT NULL UNIQUE,
  cliente_nome TEXT NOT NULL,
  cliente_email TEXT NOT NULL DEFAULT '',
  cliente_whatsapp TEXT NOT NULL,
  observacao TEXT NOT NULL DEFAULT '',
  tipo_entrega TEXT NOT NULL DEFAULT 'RETIRADA',
  valor_total_centavos INTEGER NOT NULL CHECK (valor_total_centavos >= 0),
  status_pagamento TEXT NOT NULL DEFAULT 'PENDENTE'
    CHECK (status_pagamento IN ('PENDENTE', 'PAGO', 'CANCELADO', 'EXPIRADO', 'REEMBOLSADO')),
  status_pedido TEXT NOT NULL DEFAULT 'NOVO',
  status_comanda TEXT NOT NULL DEFAULT 'ABERTA'
    CHECK (status_comanda IN ('ABERTA', 'ENCERRADA')),
  origem_pedido TEXT NOT NULL DEFAULT 'SITE'
    CHECK (origem_pedido IN ('SITE', 'MANUAL')),
  arquivado INTEGER NOT NULL DEFAULT 0 CHECK (arquivado IN (0, 1)),
  arquivado_em TEXT,
  reserva_status TEXT NOT NULL DEFAULT 'SEM_RESERVA'
    CHECK (reserva_status IN ('SEM_RESERVA', 'ATIVA', 'CONVERTIDA', 'LIBERADA')),
  reserva_expira_em TEXT,
  reserva_liberada_em TEXT,
  estoque_baixado_em TEXT,
  mp_payment_id TEXT UNIQUE,
  mp_status TEXT,
  mp_qr_code TEXT,
  mp_qr_code_base64 TEXT,
  mp_ticket_url TEXT,
  pix_expira_em TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  pago_em TEXT
);

-- status_pedido: RECEBIDO->NOVO, EM_PREPARACAO->PREPARANDO,
-- PRONTO_PARA_RETIRADA->PRONTO, RETIRADO->ENTREGUE (mesmo enum de produção,
-- confirmado em order.model.ts / OrderStatusSelect.tsx). CANCELADO não é
-- inferido de status_pagamento: o rebuild nunca teve esse valor em
-- status_preparo, então nenhum pedido existente é reclassificado como
-- cancelado por invenção — só remapeamos o que já estava lá.
--
-- status_comanda: ENCERRADA só para quem já virou ENTREGUE, espelhando
-- exatamente a lógica da migration 026 de produção (que também olhava só
-- para status_pedido, não para status_pagamento).
INSERT INTO pedidos__novo (
  id, token_publico, cliente_nome, cliente_email, cliente_whatsapp, observacao,
  tipo_entrega, valor_total_centavos, status_pagamento, status_pedido, status_comanda,
  origem_pedido, arquivado, arquivado_em, reserva_status, reserva_expira_em,
  reserva_liberada_em, estoque_baixado_em, mp_payment_id, mp_status, mp_qr_code,
  mp_qr_code_base64, mp_ticket_url, pix_expira_em, idempotency_key, criado_em,
  atualizado_em, pago_em
)
SELECT
  id, token_publico, cliente_nome, '', cliente_whatsapp, recado,
  'RETIRADA', valor_total_centavos, status_pagamento,
  CASE status_preparo
    WHEN 'RECEBIDO' THEN 'NOVO'
    WHEN 'EM_PREPARACAO' THEN 'PREPARANDO'
    WHEN 'PRONTO_PARA_RETIRADA' THEN 'PRONTO'
    WHEN 'RETIRADO' THEN 'ENTREGUE'
    ELSE 'NOVO'
  END,
  CASE WHEN status_preparo = 'RETIRADO' THEN 'ENCERRADA' ELSE 'ABERTA' END,
  'SITE', 0, NULL, 'SEM_RESERVA', NULL, NULL, NULL,
  mp_payment_id, mp_status, mp_qr_code, mp_qr_code_base64, mp_ticket_url,
  pix_expira_em, idempotency_key, criado_em, atualizado_em, pago_em
FROM pedidos;

DROP TABLE pedidos;
ALTER TABLE pedidos__novo RENAME TO pedidos;

CREATE INDEX idx_pedidos_status_pagamento ON pedidos(status_pagamento, criado_em);
CREATE INDEX idx_pedidos_mp_payment_id ON pedidos(mp_payment_id);
CREATE INDEX idx_pedidos_status_pedido ON pedidos(status_pedido, criado_em);
CREATE INDEX idx_pedidos_status_comanda ON pedidos(status_comanda, atualizado_em);
CREATE INDEX idx_pedidos_origem ON pedidos(origem_pedido, criado_em);
CREATE INDEX idx_pedidos_arquivado ON pedidos(arquivado, criado_em);

-- Fecha a comanda automaticamente ao chegar num status terminal — mesma
-- migration 029 de produção. Comportamento é unidirecional de propósito:
-- produção não reabre a comanda se o status_pedido for alterado de volta
-- depois de ENCERRADA (confirmado lendo functions/api/admin/orders/[id].js:
-- o PATCH genérico de status_pedido só escreve em `pedidos.status_pedido`,
-- nunca em `status_comanda`).
CREATE TRIGGER pedidos_encerrar_comanda_status_terminal
AFTER UPDATE OF status_pedido ON pedidos
FOR EACH ROW
WHEN UPPER(NEW.status_pedido) IN ('ENTREGUE', 'CANCELADO')
BEGIN
  UPDATE pedidos
  SET status_comanda = 'ENCERRADA'
  WHERE id = NEW.id AND status_comanda <> 'ENCERRADA';
END;

PRAGMA defer_foreign_keys = OFF;
