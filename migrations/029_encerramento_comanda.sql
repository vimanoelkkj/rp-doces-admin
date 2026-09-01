CREATE TRIGGER pedidos_encerrar_comanda_status_terminal
AFTER UPDATE OF status_pedido ON pedidos
FOR EACH ROW
WHEN UPPER(NEW.status_pedido) IN ('ENTREGUE','CANCELADO')
BEGIN
  UPDATE pedidos
  SET status_comanda = 'ENCERRADA'
  WHERE id = NEW.id AND status_comanda <> 'ENCERRADA';
END;
