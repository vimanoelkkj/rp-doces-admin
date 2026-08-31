-- AUTO-GERADO. NÃO EDITE MANUALMENTE.
-- Fonte de verdade: migrations/*.sql
-- Gere novamente com: npm run schema:generate
-- Snapshot estrutural do D1 após aplicar todas as migrations atuais.

-- table: admin_passkey_challenges
CREATE TABLE admin_passkey_challenges (
  id TEXT PRIMARY KEY,
  usuario_id INTEGER,
  tipo TEXT NOT NULL CHECK (tipo IN ('REGISTRO','LOGIN')),
  challenge TEXT NOT NULL,
  rp_id TEXT NOT NULL,
  origin TEXT NOT NULL,
  expira_em TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (usuario_id) REFERENCES usuarios_admin(id) ON DELETE CASCADE,
  CHECK (tipo = 'LOGIN' OR usuario_id IS NOT NULL)
);

-- table: admin_passkeys
CREATE TABLE admin_passkeys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER NOT NULL,
  credential_id TEXT NOT NULL UNIQUE,
  public_key BLOB NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0 CHECK (counter >= 0),
  transports TEXT NOT NULL DEFAULT '[]',
  device_type TEXT NOT NULL,
  backed_up INTEGER NOT NULL DEFAULT 0 CHECK (backed_up IN (0,1)),
  rp_id TEXT NOT NULL,
  nome TEXT NOT NULL DEFAULT 'Biometria',
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ultimo_uso_em TEXT,
  FOREIGN KEY (usuario_id) REFERENCES usuarios_admin(id) ON DELETE CASCADE
);

-- table: admin_sessoes
CREATE TABLE admin_sessoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expira_em TEXT NOT NULL,
  FOREIGN KEY (usuario_id) REFERENCES usuarios_admin(id) ON DELETE CASCADE
);

-- table: auth_rate_limits
CREATE TABLE auth_rate_limits (
  chave TEXT PRIMARY KEY,
  falhas INTEGER NOT NULL DEFAULT 0,
  janela_inicio TEXT NOT NULL,
  bloqueado_ate TEXT,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- table: categorias
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

-- table: checkout_rate_limits
CREATE TABLE checkout_rate_limits (
  chave TEXT PRIMARY KEY,
  tentativas INTEGER NOT NULL DEFAULT 1,
  expira_em INTEGER NOT NULL
);

-- table: configuracoes_loja
CREATE TABLE configuracoes_loja (
  chave TEXT PRIMARY KEY,
  valor TEXT NOT NULL DEFAULT '',
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- table: pedido_itens
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
  FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE CASCADE,
  FOREIGN KEY (produto_id) REFERENCES produtos(id) ON DELETE SET NULL
);

-- table: pedidos
CREATE TABLE "pedidos" (
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
  arquivado_em TEXT, reserva_status TEXT NOT NULL DEFAULT 'SEM_RESERVA' CHECK (reserva_status IN ('SEM_RESERVA', 'ATIVA', 'CONVERTIDA', 'LIBERADA')), reserva_expira_em TEXT, reserva_liberada_em TEXT, pix_expira_em TEXT, origem_pedido TEXT NOT NULL DEFAULT 'SITE'
  CHECK (origem_pedido IN ('SITE', 'MANUAL')),
  FOREIGN KEY (produto_id) REFERENCES produtos(id) ON DELETE SET NULL
);

-- table: produtos
CREATE TABLE "produtos" (
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

-- table: push_eventos
CREATE TABLE push_eventos (
  pedido_id INTEGER PRIMARY KEY,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE CASCADE
);

-- table: push_inscricoes
CREATE TABLE push_inscricoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (usuario_id) REFERENCES usuarios_admin(id) ON DELETE CASCADE
);

-- table: tokens_recuperacao
CREATE TABLE tokens_recuperacao (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expira_em TEXT NOT NULL,
  usado INTEGER NOT NULL DEFAULT 0 CHECK (usado IN (0,1)),
  FOREIGN KEY (usuario_id) REFERENCES usuarios_admin(id) ON DELETE CASCADE
);

-- table: usuarios_admin
CREATE TABLE usuarios_admin (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  senha_hash TEXT NOT NULL,
  ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0,1)),
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
, username TEXT COLLATE NOCASE, papel TEXT NOT NULL DEFAULT 'ADMIN' CHECK (papel IN ('OWNER','ADMIN')), avatar_key TEXT);

-- index: idx_admin_passkey_challenges_expira
CREATE INDEX idx_admin_passkey_challenges_expira
ON admin_passkey_challenges(expira_em);

-- index: idx_admin_passkeys_rp
CREATE INDEX idx_admin_passkeys_rp
ON admin_passkeys(rp_id, usuario_id);

-- index: idx_admin_passkeys_usuario
CREATE INDEX idx_admin_passkeys_usuario
ON admin_passkeys(usuario_id);

-- index: idx_admin_sessoes_token
CREATE INDEX idx_admin_sessoes_token ON admin_sessoes(token_hash);

-- index: idx_admin_sessoes_usuario
CREATE INDEX idx_admin_sessoes_usuario ON admin_sessoes(usuario_id);

-- index: idx_auth_rate_limits_bloqueado
CREATE INDEX idx_auth_rate_limits_bloqueado
ON auth_rate_limits(bloqueado_ate);

-- index: idx_categorias_ativo_ordem
CREATE INDEX idx_categorias_ativo_ordem
  ON categorias (ativo, ordem, nome);

-- index: idx_checkout_rate_limits_expira
CREATE INDEX idx_checkout_rate_limits_expira
ON checkout_rate_limits(expira_em);

-- index: idx_pedido_itens_estoque
CREATE INDEX idx_pedido_itens_estoque ON pedido_itens(pedido_id, estoque_baixado_em);

-- index: idx_pedido_itens_pedido
CREATE INDEX idx_pedido_itens_pedido ON pedido_itens(pedido_id);

-- index: idx_pedido_itens_produto
CREATE INDEX idx_pedido_itens_produto ON pedido_itens(produto_id);

-- index: idx_pedidos_arquivado
CREATE INDEX idx_pedidos_arquivado ON pedidos(arquivado, criado_em);

-- index: idx_pedidos_estoque_baixado
CREATE INDEX idx_pedidos_estoque_baixado ON pedidos(status_pagamento, estoque_baixado_em);

-- index: idx_pedidos_mp_order_id
CREATE INDEX idx_pedidos_mp_order_id ON pedidos(mp_order_id);

-- index: idx_pedidos_origem
CREATE INDEX idx_pedidos_origem
ON pedidos(origem_pedido, criado_em);

-- index: idx_pedidos_produto_id
CREATE INDEX idx_pedidos_produto_id ON pedidos(produto_id);

-- index: idx_pedidos_reserva_ativa
CREATE INDEX idx_pedidos_reserva_ativa
ON pedidos(reserva_expira_em)
WHERE status_pagamento = 'PENDENTE' AND reserva_status = 'ATIVA';

-- index: idx_pedidos_status_pagamento
CREATE INDEX idx_pedidos_status_pagamento ON pedidos(status_pagamento, criado_em);

-- index: idx_pedidos_status_pedido
CREATE INDEX idx_pedidos_status_pedido ON pedidos(status_pedido, criado_em);

-- index: idx_produtos_ativo_disponivel
CREATE INDEX idx_produtos_ativo_disponivel
  ON produtos(ativo, disponivel);

-- index: idx_produtos_categoria_ordem
CREATE INDEX idx_produtos_categoria_ordem
  ON produtos(categoria, ordem, nome);

-- index: idx_push_inscricoes_usuario
CREATE INDEX idx_push_inscricoes_usuario ON push_inscricoes(usuario_id);

-- index: idx_tokens_recuperacao_hash
CREATE INDEX idx_tokens_recuperacao_hash ON tokens_recuperacao(token_hash);

-- index: idx_usuarios_admin_papel_ativo
CREATE INDEX idx_usuarios_admin_papel_ativo ON usuarios_admin(papel, ativo);

-- index: idx_usuarios_admin_username
CREATE UNIQUE INDEX idx_usuarios_admin_username
ON usuarios_admin(username COLLATE NOCASE);
