ALTER TABLE pedidos ADD COLUMN status_comanda TEXT NOT NULL DEFAULT 'ABERTA'
  CHECK (status_comanda IN ('ABERTA','ENCERRADA'));

UPDATE pedidos
SET status_comanda = CASE
  WHEN UPPER(COALESCE(status_pedido, 'NOVO')) IN ('ENTREGUE','CANCELADO') THEN 'ENCERRADA'
  ELSE 'ABERTA'
END;

CREATE INDEX idx_pedidos_status_comanda
  ON pedidos(status_comanda, atualizado_em);
