CREATE TABLE IF NOT EXISTS configuracoes_loja (
  chave TEXT PRIMARY KEY,
  valor TEXT NOT NULL DEFAULT '',
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO configuracoes_loja (chave, valor) VALUES
('whatsapp', '5533991285907'),
('local_retirada', 'Temponi Concept'),
('entregas_status', 'EM_BREVE'),
('horario_atendimento', ''),
('mensagem_whatsapp', 'Olá! Gostaria de fazer um pedido na R&P Doces.');
