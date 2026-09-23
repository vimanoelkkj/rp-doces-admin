-- Migration 0030: PWA Admin V2 - Web Push Subscriptions e Registro de Eventos Push

CREATE TABLE IF NOT EXISTS push_inscricoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER NOT NULL REFERENCES usuarios_admin(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_push_inscricoes_usuario ON push_inscricoes(usuario_id);

-- Convergência segura para push_eventos:
-- O banco remoto possui uma versão legada desta tabela com schema:
-- (pedido_id INTEGER PRIMARY KEY, criado_em TEXT).
-- Garantimos que a tabela exista (caso o banco seja novo), criamos a __v2
-- com a chave composta (pedido_id, evento) e novas colunas de estado,
-- preservamos dados legados como 'PEDIDO_PAGO' e 'ENVIADO', removemos a antiga e renomeamos.

CREATE TABLE IF NOT EXISTS push_eventos (
  pedido_id INTEGER PRIMARY KEY,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS push_eventos__v2 (
  pedido_id INTEGER NOT NULL,
  evento TEXT NOT NULL DEFAULT 'PEDIDO_PAGO',
  status TEXT NOT NULL DEFAULT 'PENDENTE',
  tentativas INTEGER NOT NULL DEFAULT 0,
  ultimo_erro TEXT,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (pedido_id, evento)
);

INSERT OR IGNORE INTO push_eventos__v2 (pedido_id, evento, status, criado_em)
SELECT pedido_id, 'PEDIDO_PAGO', 'ENVIADO', criado_em FROM push_eventos;

DROP TABLE push_eventos;

ALTER TABLE push_eventos__v2 RENAME TO push_eventos;

CREATE INDEX IF NOT EXISTS idx_push_eventos_status ON push_eventos(status, criado_em);
