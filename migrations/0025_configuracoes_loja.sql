-- Persistência das configurações exibidas no painel "Loja" e consumidas
-- pela home/footer públicos. Registro singleton (id = 1).
CREATE TABLE configuracoes_loja (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  seg INTEGER NOT NULL DEFAULT 0 CHECK (seg IN (0, 1)),
  ter INTEGER NOT NULL DEFAULT 1 CHECK (ter IN (0, 1)),
  qua INTEGER NOT NULL DEFAULT 1 CHECK (qua IN (0, 1)),
  qui INTEGER NOT NULL DEFAULT 1 CHECK (qui IN (0, 1)),
  sex INTEGER NOT NULL DEFAULT 1 CHECK (sex IN (0, 1)),
  sab INTEGER NOT NULL DEFAULT 1 CHECK (sab IN (0, 1)),
  dom INTEGER NOT NULL DEFAULT 0 CHECK (dom IN (0, 1)),
  horario_abre TEXT NOT NULL DEFAULT '09:00',
  horario_fecha TEXT NOT NULL DEFAULT '20:00',
  local_nome TEXT NOT NULL DEFAULT 'Temponi Concept',
  endereco TEXT NOT NULL DEFAULT 'Rua Lais Bertoni Pereira 182 Cambuí Sala 07',
  maps_link TEXT NOT NULL DEFAULT 'https://maps.google.com/?q=Temponi+Concept',
  entrega_status TEXT NOT NULL DEFAULT 'unavailable'
    CHECK (entrega_status IN ('soon', 'available', 'unavailable')),
  whatsapp TEXT NOT NULL DEFAULT '(33) 99128-5907',
  mensagem_padrao TEXT NOT NULL DEFAULT 'Olá! Gostaria de fazer um pedido de bolo.',
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO configuracoes_loja (
  id, seg, ter, qua, qui, sex, sab, dom,
  horario_abre, horario_fecha, local_nome, endereco, maps_link,
  entrega_status, whatsapp, mensagem_padrao
) VALUES (
  1, 0, 1, 1, 1, 1, 1, 0,
  '09:00', '20:00', 'Temponi Concept',
  'Rua Lais Bertoni Pereira 182 Cambuí Sala 07',
  'https://maps.google.com/?q=Temponi+Concept',
  'unavailable', '(33) 99128-5907',
  'Olá! Gostaria de fazer um pedido de bolo.'
);

PRAGMA foreign_key_check;
