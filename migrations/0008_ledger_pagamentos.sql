-- Passo 4a: capacidade estrutural do razão financeiro, sem mudar
-- comportamento em runtime.
--
-- 1) pedido_pagamentos / pedido_pagamento_alocacoes: criadas vazias, DDL
--    idêntico ao de produção (migrations 025/028/035 já consolidadas).
--    Nenhuma materialização de pagamento legado acontece aqui — isso é 4b.
-- 2) pedidos: reconstrução (create __novo/copy/drop/rename) só para remover
--    o CHECK de status_pagamento, que produção nunca teve (a coluna passa a
--    carregar, com o tempo, tanto o vocabulário de evento quanto a projeção
--    agregada PENDENTE/PARCIAL/PAGO — validação fica em código de aplicação
--    a partir do 4c). Cópia é 1:1, sem CASE, sem remapear nenhum valor.

PRAGMA defer_foreign_keys = ON;

CREATE TABLE pedido_pagamentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pedido_id INTEGER NOT NULL,
  metodo TEXT NOT NULL CHECK (metodo IN ('PIX_MP','PIX_EXTERNO','CARTAO','DINHEIRO','A_COMBINAR')),
  origem TEXT NOT NULL CHECK (origem IN ('SITE','ADMIN')),
  valor_centavos INTEGER NOT NULL CHECK (valor_centavos > 0),
  status TEXT NOT NULL DEFAULT 'PENDENTE'
    CHECK (status IN ('PENDENTE','PAGO','CANCELADO','EXPIRADO','REEMBOLSADO','FALHOU')),
  mp_order_id TEXT,
  mp_payment_id TEXT,
  mp_status TEXT,
  mp_status_detail TEXT,
  mp_ticket_url TEXT,
  mp_qr_code TEXT,
  mp_qr_code_base64 TEXT,
  pix_expira_em TEXT,
  idempotency_key TEXT,
  substitui_pagamento_id INTEGER,
  registrado_por_usuario_id INTEGER,
  observacao TEXT NOT NULL DEFAULT '',
  valor_original_centavos INTEGER CHECK (valor_original_centavos IS NULL OR valor_original_centavos > 0),
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  pago_em TEXT,
  cancelado_em TEXT,
  FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE CASCADE,
  FOREIGN KEY (substitui_pagamento_id) REFERENCES pedido_pagamentos(id) ON DELETE SET NULL,
  FOREIGN KEY (registrado_por_usuario_id) REFERENCES usuarios_admin(id) ON DELETE SET NULL
);

CREATE TABLE pedido_pagamento_alocacoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pagamento_id INTEGER NOT NULL,
  pedido_item_id INTEGER NOT NULL,
  valor_centavos INTEGER NOT NULL CHECK (valor_centavos > 0),
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (pagamento_id) REFERENCES pedido_pagamentos(id) ON DELETE CASCADE,
  FOREIGN KEY (pedido_item_id) REFERENCES pedido_itens(id) ON DELETE CASCADE,
  UNIQUE (pagamento_id, pedido_item_id)
);

CREATE INDEX idx_pedido_pagamentos_pedido_status
  ON pedido_pagamentos(pedido_id, status, criado_em);
CREATE INDEX idx_pedido_pagamento_alocacoes_pagamento
  ON pedido_pagamento_alocacoes(pagamento_id);
CREATE INDEX idx_pedido_pagamento_alocacoes_item
  ON pedido_pagamento_alocacoes(pedido_item_id);
CREATE UNIQUE INDEX uq_pedido_pagamentos_mp_order
  ON pedido_pagamentos(mp_order_id)
  WHERE mp_order_id IS NOT NULL;
CREATE UNIQUE INDEX uq_pedido_pagamentos_idempotency
  ON pedido_pagamentos(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Reconstrução de pedidos só para remover o CHECK de status_pagamento.
-- Cópia 1:1, todas as outras colunas/constraints idênticas às de hoje.
CREATE TABLE pedidos__novo (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_publico TEXT NOT NULL UNIQUE,
  cliente_nome TEXT NOT NULL,
  cliente_email TEXT NOT NULL DEFAULT '',
  cliente_whatsapp TEXT NOT NULL,
  observacao TEXT NOT NULL DEFAULT '',
  tipo_entrega TEXT NOT NULL DEFAULT 'RETIRADA',
  valor_total_centavos INTEGER NOT NULL CHECK (valor_total_centavos >= 0),
  status_pagamento TEXT NOT NULL DEFAULT 'PENDENTE',
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

INSERT INTO pedidos__novo SELECT * FROM pedidos;

DROP TABLE pedidos;
ALTER TABLE pedidos__novo RENAME TO pedidos;

CREATE INDEX idx_pedidos_status_pagamento ON pedidos(status_pagamento, criado_em);
CREATE INDEX idx_pedidos_mp_payment_id ON pedidos(mp_payment_id);
CREATE INDEX idx_pedidos_status_pedido ON pedidos(status_pedido, criado_em);
CREATE INDEX idx_pedidos_status_comanda ON pedidos(status_comanda, atualizado_em);
CREATE INDEX idx_pedidos_origem ON pedidos(origem_pedido, criado_em);
CREATE INDEX idx_pedidos_arquivado ON pedidos(arquivado, criado_em);

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
