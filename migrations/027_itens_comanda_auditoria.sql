ALTER TABLE pedido_itens ADD COLUMN adicionado_por_usuario_id INTEGER REFERENCES usuarios_admin(id) ON DELETE SET NULL;
ALTER TABLE pedido_itens ADD COLUMN adicionado_em TEXT;

UPDATE pedido_itens
SET adicionado_em = COALESCE(adicionado_em, CURRENT_TIMESTAMP)
WHERE adicionado_em IS NULL;

CREATE INDEX idx_pedido_itens_adicionado_por
  ON pedido_itens(pedido_id, adicionado_por_usuario_id, id);
