-- Migration 0032: Guarda no banco para invariante do último OWNER ativo
--
-- Garante que a tabela usuarios_admin sempre preserve pelo menos 1 usuário
-- com papel = 'OWNER' AND ativo = 1, impedindo que corridas concorrentes de
-- desativação (toggle_ativo) ou rebaixamento (alterar_papel), ou deleções,
-- deixem a loja sem nenhum administrador mestre ativo.

CREATE TRIGGER usuarios_admin_guard_ultimo_owner_update
BEFORE UPDATE OF papel, ativo ON usuarios_admin
FOR EACH ROW WHEN
  OLD.papel = 'OWNER'
  AND OLD.ativo = 1
  AND NOT (
    NEW.papel = 'OWNER'
    AND NEW.ativo = 1
  )
  AND NOT EXISTS (
    SELECT 1 FROM usuarios_admin
    WHERE id <> OLD.id
      AND papel = 'OWNER'
      AND ativo = 1
  )
BEGIN
  SELECT RAISE(ABORT, 'ultimo_owner_ativo');
END;

CREATE TRIGGER usuarios_admin_guard_ultimo_owner_delete
BEFORE DELETE ON usuarios_admin
FOR EACH ROW WHEN
  OLD.papel = 'OWNER'
  AND OLD.ativo = 1
  AND NOT EXISTS (
    SELECT 1 FROM usuarios_admin
    WHERE id <> OLD.id
      AND papel = 'OWNER'
      AND ativo = 1
  )
BEGIN
  SELECT RAISE(ABORT, 'ultimo_owner_ativo');
END;
