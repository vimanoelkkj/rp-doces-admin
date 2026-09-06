ALTER TABLE pedido_pagamentos
ADD COLUMN valor_original_centavos INTEGER
CHECK (valor_original_centavos IS NULL OR valor_original_centavos > 0);

UPDATE pedido_pagamentos
SET valor_original_centavos = valor_centavos
WHERE valor_original_centavos IS NULL;
