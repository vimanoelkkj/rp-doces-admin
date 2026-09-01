ALTER TABLE pedido_pagamentos ADD COLUMN pix_expira_em TEXT;

UPDATE pedido_pagamentos
SET pix_expira_em = CASE
  WHEN metodo = 'PIX_MP' AND status = 'PENDENTE' THEN datetime(criado_em, '+30 minutes')
  ELSE NULL
END
WHERE pix_expira_em IS NULL;
