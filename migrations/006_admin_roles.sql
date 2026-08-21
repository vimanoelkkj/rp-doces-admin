ALTER TABLE usuarios_admin ADD COLUMN papel TEXT NOT NULL DEFAULT 'ADMIN' CHECK (papel IN ('OWNER','ADMIN'));

UPDATE usuarios_admin
SET papel = 'OWNER'
WHERE username = 'vitor';

CREATE INDEX IF NOT EXISTS idx_usuarios_admin_papel_ativo ON usuarios_admin(papel, ativo);
