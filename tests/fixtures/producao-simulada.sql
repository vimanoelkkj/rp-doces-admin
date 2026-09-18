-- Reprodução LOCAL e DESCARTÁVEL da TOPOLOGIA do D1 de produção, como
-- observada na auditoria B5 Fase 1 (read-only).
--
-- É o schema real transcrito do `sqlite_master` de produção, não uma
-- aproximação: é contra ele que o script de compatibilidade e os handlers
-- reais do rebuild são exercitados antes de qualquer toque no banco real.
--
-- NENHUM dado pessoal de produção é reproduzido. Só a ESTRUTURA. As linhas
-- são sintéticas e geradas pelo helper de teste.
--
-- Diferenças relevantes em relação ao schema das migrations do rebuild,
-- todas intencionais porque existem de verdade em produção:
--   * `pedidos` carrega o modelo legado "um produto por pedido"
--     (produto_id/produto_nome/quantidade/valor_unitario_centavos), com as
--     três últimas NOT NULL e SEM DEFAULT;
--   * `pedidos.cliente_email` é NOT NULL e SEM DEFAULT;
--   * `pedidos.mp_payment_id` NÃO é UNIQUE (só token_publico, mp_order_id e
--     idempotency_key são);
--   * `pedidos` tem `metodo_pagamento`, `mp_order_id`, `mp_status_detail`;
--   * `pedido_operacoes` NÃO existe;
--   * `idx_pedido_pagamentos_mp_payment_id` NÃO existe.

CREATE TABLE produtos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  categoria TEXT NOT NULL,
  descricao TEXT NOT NULL DEFAULT '',
  preco_centavos INTEGER NOT NULL CHECK (preco_centavos >= 1),
  disponivel INTEGER NOT NULL DEFAULT 1 CHECK (disponivel IN (0, 1)),
  ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
  destaque INTEGER NOT NULL DEFAULT 0 CHECK (destaque IN (0, 1)),
  ordem INTEGER NOT NULL DEFAULT 0,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  emoji TEXT NOT NULL DEFAULT '',
  estoque INTEGER NOT NULL DEFAULT 0 CHECK (estoque >= 0),
  promocao_ativa INTEGER NOT NULL DEFAULT 0,
  preco_promocional_centavos INTEGER,
  promocao_inicio TEXT,
  promocao_fim TEXT,
  estoque_reservado INTEGER NOT NULL DEFAULT 0
    CHECK (estoque_reservado >= 0 AND estoque_reservado <= estoque)
, image_key TEXT);

CREATE TABLE categorias (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  emoji TEXT NOT NULL DEFAULT '🍰',
  descricao TEXT NOT NULL DEFAULT '',
  ordem INTEGER NOT NULL DEFAULT 0,
  ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
  sistema INTEGER NOT NULL DEFAULT 0 CHECK (sistema IN (0, 1)),
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE usuarios_admin (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  username TEXT NOT NULL COLLATE NOCASE,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  senha_hash TEXT NOT NULL,
  papel TEXT NOT NULL DEFAULT 'ADMIN' CHECK (papel IN ('OWNER', 'ADMIN')),
  ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX idx_usuarios_admin_username ON usuarios_admin(username COLLATE NOCASE);
CREATE INDEX idx_usuarios_admin_papel_ativo ON usuarios_admin(papel, ativo);

CREATE TABLE admin_sessoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER NOT NULL REFERENCES usuarios_admin(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expira_em TEXT NOT NULL
);
CREATE INDEX idx_admin_sessoes_token ON admin_sessoes(token_hash);
CREATE INDEX idx_admin_sessoes_usuario ON admin_sessoes(usuario_id);

CREATE TABLE auth_rate_limits (
  chave TEXT PRIMARY KEY,
  falhas INTEGER NOT NULL DEFAULT 0,
  janela_inicio TEXT NOT NULL,
  bloqueado_ate TEXT,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- O `pedidos` histórico: modelo legado de um produto por pedido, ainda
-- obrigatório, convivendo com as colunas do modelo atual.
CREATE TABLE pedidos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_publico TEXT NOT NULL UNIQUE,
  produto_id INTEGER,
  produto_nome TEXT NOT NULL,
  quantidade INTEGER NOT NULL CHECK (quantidade >= 1 AND quantidade <= 50),
  valor_unitario_centavos INTEGER NOT NULL CHECK (valor_unitario_centavos >= 0),
  valor_total_centavos INTEGER NOT NULL CHECK (valor_total_centavos >= 0),
  cliente_nome TEXT NOT NULL,
  cliente_email TEXT NOT NULL,
  observacao TEXT NOT NULL DEFAULT '',
  metodo_pagamento TEXT NOT NULL DEFAULT 'PIX',
  status_pagamento TEXT NOT NULL DEFAULT 'PENDENTE',
  mp_order_id TEXT UNIQUE,
  mp_payment_id TEXT,
  mp_status TEXT,
  mp_status_detail TEXT,
  mp_ticket_url TEXT,
  mp_qr_code TEXT,
  mp_qr_code_base64 TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  pago_em TEXT,
  status_pedido TEXT NOT NULL DEFAULT 'NOVO',
  cliente_whatsapp TEXT NOT NULL DEFAULT '',
  tipo_entrega TEXT NOT NULL DEFAULT 'RETIRADA',
  estoque_baixado_em TEXT,
  arquivado INTEGER NOT NULL DEFAULT 0,
  arquivado_em TEXT,
  reserva_status TEXT NOT NULL DEFAULT 'SEM_RESERVA'
    CHECK (reserva_status IN ('SEM_RESERVA', 'ATIVA', 'CONVERTIDA', 'LIBERADA')),
  reserva_expira_em TEXT,
  reserva_liberada_em TEXT,
  pix_expira_em TEXT,
  origem_pedido TEXT NOT NULL DEFAULT 'SITE'
    CHECK (origem_pedido IN ('SITE', 'MANUAL')),
  status_comanda TEXT NOT NULL DEFAULT 'ABERTA'
    CHECK (status_comanda IN ('ABERTA','ENCERRADA')),
  FOREIGN KEY (produto_id) REFERENCES produtos(id) ON DELETE SET NULL
);

CREATE INDEX idx_pedidos_mp_order_id ON pedidos(mp_order_id);
CREATE INDEX idx_pedidos_status_pagamento ON pedidos(status_pagamento, criado_em);
CREATE INDEX idx_pedidos_status_pedido ON pedidos(status_pedido, criado_em);
CREATE INDEX idx_pedidos_estoque_baixado ON pedidos(estoque_baixado_em);
CREATE INDEX idx_pedidos_arquivado ON pedidos(arquivado, criado_em);
CREATE INDEX idx_pedidos_produto_id ON pedidos(produto_id);
CREATE INDEX idx_pedidos_status_comanda ON pedidos(status_comanda, atualizado_em);
CREATE INDEX idx_pedidos_origem ON pedidos(origem_pedido, criado_em);
CREATE INDEX idx_pedidos_reserva_ativa ON pedidos(reserva_expira_em)
  WHERE status_pagamento = 'PENDENTE' AND reserva_status = 'ATIVA';

CREATE TRIGGER pedidos_encerrar_comanda_status_terminal
AFTER UPDATE OF status_pedido ON pedidos
FOR EACH ROW
WHEN UPPER(NEW.status_pedido) IN ('ENTREGUE', 'CANCELADO')
BEGIN
  UPDATE pedidos
  SET status_comanda = 'ENCERRADA'
  WHERE id = NEW.id AND status_comanda <> 'ENCERRADA';
END;

CREATE TABLE pedido_itens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pedido_id INTEGER NOT NULL,
  produto_id INTEGER,
  produto_nome TEXT NOT NULL,
  quantidade INTEGER NOT NULL CHECK (quantidade >= 1 AND quantidade <= 50),
  valor_unitario_centavos INTEGER NOT NULL CHECK (valor_unitario_centavos >= 0),
  valor_total_centavos INTEGER NOT NULL CHECK (valor_total_centavos >= 0),
  estoque_baixado_em TEXT,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  adicionado_por_usuario_id INTEGER REFERENCES usuarios_admin(id) ON DELETE SET NULL,
  adicionado_em TEXT,
  FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE CASCADE,
  FOREIGN KEY (produto_id) REFERENCES produtos(id) ON DELETE SET NULL
);
CREATE INDEX idx_pedido_itens_pedido ON pedido_itens(pedido_id);
CREATE INDEX idx_pedido_itens_produto ON pedido_itens(produto_id);
CREATE INDEX idx_pedido_itens_estoque ON pedido_itens(pedido_id, estoque_baixado_em);
CREATE INDEX idx_pedido_itens_adicionado_por
  ON pedido_itens(pedido_id, adicionado_por_usuario_id, id);

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
  idempotency_key TEXT,
  substitui_pagamento_id INTEGER,
  registrado_por_usuario_id INTEGER,
  observacao TEXT NOT NULL DEFAULT '',
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  pago_em TEXT,
  cancelado_em TEXT,
  pix_expira_em TEXT,
  valor_original_centavos INTEGER
    CHECK (valor_original_centavos IS NULL OR valor_original_centavos > 0),
  FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE CASCADE,
  FOREIGN KEY (substitui_pagamento_id) REFERENCES pedido_pagamentos(id) ON DELETE SET NULL,
  FOREIGN KEY (registrado_por_usuario_id) REFERENCES usuarios_admin(id) ON DELETE SET NULL
);
CREATE INDEX idx_pedido_pagamentos_pedido_status
  ON pedido_pagamentos(pedido_id, status, criado_em);
CREATE UNIQUE INDEX uq_pedido_pagamentos_mp_order
  ON pedido_pagamentos(mp_order_id) WHERE mp_order_id IS NOT NULL;
CREATE UNIQUE INDEX uq_pedido_pagamentos_idempotency
  ON pedido_pagamentos(idempotency_key) WHERE idempotency_key IS NOT NULL;

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
CREATE INDEX idx_pedido_pagamento_alocacoes_pagamento
  ON pedido_pagamento_alocacoes(pagamento_id);
CREATE INDEX idx_pedido_pagamento_alocacoes_item
  ON pedido_pagamento_alocacoes(pedido_item_id);

CREATE TABLE pedido_reembolsos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pedido_id INTEGER NOT NULL,
  pagamento_id INTEGER NOT NULL,
  origem TEXT NOT NULL CHECK (origem IN ('MERCADO_PAGO','MANUAL')),
  metodo TEXT NOT NULL CHECK (metodo IN ('PIX_MP','PIX_EXTERNO','CARTAO','DINHEIRO','OUTRO')),
  valor_centavos INTEGER NOT NULL CHECK (valor_centavos > 0),
  status TEXT NOT NULL DEFAULT 'PENDENTE'
    CHECK (status IN ('PENDENTE','REEMBOLSADO','FALHOU')),
  mp_refund_id TEXT,
  mp_status TEXT,
  idempotency_key TEXT NOT NULL,
  registrado_por_usuario_id INTEGER,
  motivo TEXT NOT NULL DEFAULT '',
  devolveu_estoque INTEGER NOT NULL DEFAULT 0 CHECK (devolveu_estoque IN (0,1)),
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  concluido_em TEXT,
  FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE CASCADE,
  FOREIGN KEY (pagamento_id) REFERENCES pedido_pagamentos(id) ON DELETE CASCADE,
  FOREIGN KEY (registrado_por_usuario_id) REFERENCES usuarios_admin(id) ON DELETE SET NULL
);
CREATE INDEX idx_pedido_reembolsos_pedido ON pedido_reembolsos(pedido_id, status, criado_em);
CREATE INDEX idx_pedido_reembolsos_pagamento ON pedido_reembolsos(pagamento_id, status);
CREATE UNIQUE INDEX uq_pedido_reembolsos_idempotency ON pedido_reembolsos(idempotency_key);

-- Tabela de produção que o rebuild não usa. Existe aqui para provar que o
-- upgrade aditivo não a toca.
CREATE TABLE configuracoes_loja (
  chave TEXT PRIMARY KEY,
  valor TEXT NOT NULL,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
