ALTER TABLE usuarios_admin ADD COLUMN username TEXT COLLATE NOCASE;

UPDATE usuarios_admin
SET username = lower(
  CASE
    WHEN instr(trim(nome), ' ') > 0 THEN substr(trim(nome), 1, instr(trim(nome), ' ') - 1)
    ELSE trim(nome)
  END
)
WHERE username IS NULL OR trim(username) = '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_usuarios_admin_username
ON usuarios_admin(username COLLATE NOCASE);
