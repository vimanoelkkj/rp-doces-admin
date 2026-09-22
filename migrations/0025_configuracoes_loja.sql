-- A tabela configuracoes_loja já existe em produção no formato chave/valor.
-- Esta migration apenas garante o schema legado e acrescenta as chaves usadas
-- pela nova tela Loja, preservando integralmente qualquer valor já salvo.
CREATE TABLE IF NOT EXISTS configuracoes_loja (
  chave TEXT PRIMARY KEY,
  valor TEXT NOT NULL DEFAULT '',
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO configuracoes_loja (chave, valor) VALUES
  ('whatsapp', '5533991285907'),
  ('local_retirada', 'Temponi Concept'),
  ('entregas_status', 'INDISPONIVEL'),
  ('horario_atendimento', ''),
  ('mensagem_whatsapp', 'Olá! Gostaria de fazer um pedido na R&P Doces.'),
  ('dia_seg', '0'),
  ('dia_ter', '1'),
  ('dia_qua', '1'),
  ('dia_qui', '1'),
  ('dia_sex', '1'),
  ('dia_sab', '1'),
  ('dia_dom', '0'),
  ('horario_abre', '09:00'),
  ('horario_fecha', '20:00'),
  ('endereco', 'Rua Lais Bertoni Pereira 182 Cambuí Sala 07'),
  ('maps_link', 'https://maps.google.com/?q=Temponi+Concept');

PRAGMA foreign_key_check;
