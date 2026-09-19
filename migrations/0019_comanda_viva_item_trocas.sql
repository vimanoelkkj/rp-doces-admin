-- COMANDA VIVA / Fase 6: troca de item como intencao atomica e auditavel.
--
-- TROCA_PENDENTE existe somente para o item destino reservado enquanto uma
-- diferenca financeira ainda precisa ser devolvida. Ele nao participa do
-- total nem do waterfall financeiro, mas representa fisicamente a reserva.

PRAGMA defer_foreign_keys = ON;

-- Triggers pertencentes a outras tabelas mantem SQL compilado contra
-- pedido_itens. Eles precisam ser recriados depois do rebuild; caso
-- contrario SQLite conserva um trigger apontando para a tabela removida.
DROP TRIGGER IF EXISTS pedido_pagamentos_reativar_reserva_por_item;
DROP TRIGGER IF EXISTS pedido_item_cancelamentos_validar_pedido_insert;
DROP TRIGGER IF EXISTS pedido_item_cancelamentos_validar_pedido_update;
DROP TRIGGER IF EXISTS pedido_reembolso_alocacoes_validar_insert;
DROP TRIGGER IF EXISTS pedido_reembolso_alocacoes_validar_update;
DROP TRIGGER IF EXISTS pedido_pagamento_alocacoes_preservar_reembolsos_update;
DROP TRIGGER IF EXISTS pedido_item_cancelamentos_preservar_reembolsos_update;

-- DROP TABLE do pai dispara ON DELETE CASCADE no SQLite mesmo com FKs
-- diferidas. As copias abaixo preservam todos os filhos antes do rebuild e
-- os restauram com os mesmos ids e timestamps depois que o novo pai existe.
CREATE TABLE _0019_operacoes AS SELECT * FROM pedido_operacoes;
CREATE TABLE _0019_reembolso_alocacoes AS SELECT * FROM pedido_reembolso_alocacoes;
CREATE TABLE _0019_cancelamentos AS SELECT * FROM pedido_item_cancelamentos;
CREATE TABLE _0019_pagamento_alocacoes AS SELECT * FROM pedido_pagamento_alocacoes;

DELETE FROM pedido_operacoes;
DELETE FROM pedido_reembolso_alocacoes;
DELETE FROM pedido_item_cancelamentos;
DELETE FROM pedido_pagamento_alocacoes;

-- Criada antes do rebuild de pedido_itens para que a FK circular nullable do
-- destino pendente sempre aponte para uma tabela real durante a copia.
CREATE TABLE pedido_item_trocas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pedido_id INTEGER NOT NULL,
  item_origem_id INTEGER NOT NULL,
  item_destino_id INTEGER,
  produto_destino_id INTEGER NOT NULL,
  quantidade_destino INTEGER NOT NULL CHECK (quantidade_destino BETWEEN 1 AND 50),
  preco_unitario_destino_centavos INTEGER NOT NULL CHECK (preco_unitario_destino_centavos >= 0),
  valor_origem_centavos INTEGER NOT NULL CHECK (valor_origem_centavos >= 0),
  valor_destino_centavos INTEGER NOT NULL CHECK (valor_destino_centavos >= 0),
  diferenca_centavos INTEGER NOT NULL,
  tipo_diferenca TEXT NOT NULL CHECK (tipo_diferenca IN ('COBRAR', 'DEVOLVER', 'ZERO')),
  estoque_acao_origem TEXT NOT NULL CHECK (estoque_acao_origem IN (
    'LIBERAR_RESERVA', 'NAO_REPOR', 'REPOR', 'NENHUMA'
  )),
  status TEXT NOT NULL CHECK (status IN (
    'SOLICITADA', 'AGUARDANDO_COBRANCA', 'AGUARDANDO_REEMBOLSO',
    'CONCLUIDA', 'INCONCLUSIVA', 'FALHOU'
  )),
  motivo TEXT NOT NULL DEFAULT '',
  registrado_por_usuario_id INTEGER,
  snapshot_financeiro TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  concluido_em TEXT,
  FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE RESTRICT,
  FOREIGN KEY (item_origem_id) REFERENCES pedido_itens(id) ON DELETE RESTRICT,
  FOREIGN KEY (item_destino_id) REFERENCES pedido_itens(id) ON DELETE RESTRICT,
  FOREIGN KEY (produto_destino_id) REFERENCES produtos(id) ON DELETE RESTRICT,
  FOREIGN KEY (registrado_por_usuario_id) REFERENCES usuarios_admin(id) ON DELETE SET NULL,
  UNIQUE (item_destino_id),
  CHECK (
    (tipo_diferenca = 'COBRAR' AND diferenca_centavos > 0)
    OR (tipo_diferenca = 'DEVOLVER' AND diferenca_centavos < 0)
    OR (tipo_diferenca = 'ZERO' AND diferenca_centavos = 0)
  )
);

CREATE TABLE pedido_itens__novo (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pedido_id INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  produto_id INTEGER REFERENCES produtos(id) ON DELETE SET NULL,
  produto_nome TEXT NOT NULL,
  quantidade INTEGER NOT NULL CHECK (quantidade >= 1 AND quantidade <= 50),
  valor_unitario_centavos INTEGER NOT NULL CHECK (valor_unitario_centavos >= 0),
  valor_total_centavos INTEGER NOT NULL CHECK (valor_total_centavos >= 0),
  estoque_baixado_em TEXT,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  adicionado_por_usuario_id INTEGER REFERENCES usuarios_admin(id) ON DELETE SET NULL,
  adicionado_em TEXT,
  status_item TEXT NOT NULL DEFAULT 'ATIVO'
    CHECK (status_item IN ('ATIVO', 'CANCELADO', 'TROCA_PENDENTE')),
  estoque_estado TEXT NOT NULL CHECK (estoque_estado IN (
    'NAO_APLICAVEL', 'SEM_RESERVA', 'RESERVADO', 'LIBERADO', 'BAIXADO', 'REPOSTO'
  )),
  estoque_reservado_em TEXT,
  estoque_liberado_em TEXT,
  estoque_reposto_em TEXT,
  pedido_item_troca_id INTEGER,
  CHECK (
    (status_item = 'TROCA_PENDENTE' AND pedido_item_troca_id IS NOT NULL)
    OR (status_item <> 'TROCA_PENDENTE' AND pedido_item_troca_id IS NULL)
  ),
  FOREIGN KEY (pedido_item_troca_id) REFERENCES pedido_item_trocas(id) ON DELETE RESTRICT
);

INSERT INTO pedido_itens__novo (
  id, pedido_id, produto_id, produto_nome, quantidade,
  valor_unitario_centavos, valor_total_centavos, estoque_baixado_em,
  criado_em, adicionado_por_usuario_id, adicionado_em,
  status_item, estoque_estado, estoque_reservado_em,
  estoque_liberado_em, estoque_reposto_em, pedido_item_troca_id
)
SELECT
  id, pedido_id, produto_id, produto_nome, quantidade,
  valor_unitario_centavos, valor_total_centavos, estoque_baixado_em,
  criado_em, adicionado_por_usuario_id, adicionado_em,
  status_item, estoque_estado, estoque_reservado_em,
  estoque_liberado_em, estoque_reposto_em, NULL
FROM pedido_itens;

DROP TABLE pedido_itens;
ALTER TABLE pedido_itens__novo RENAME TO pedido_itens;

CREATE INDEX idx_pedido_itens_pedido ON pedido_itens(pedido_id);
CREATE INDEX idx_pedido_itens_produto ON pedido_itens(produto_id);
CREATE INDEX idx_pedido_itens_estoque ON pedido_itens(pedido_id, estoque_baixado_em);
CREATE INDEX idx_pedido_itens_adicionado_por
  ON pedido_itens(pedido_id, adicionado_por_usuario_id, id);
CREATE INDEX idx_pedido_itens_estado_estoque
  ON pedido_itens(pedido_id, status_item, estoque_estado, id);
CREATE INDEX idx_pedido_itens_troca ON pedido_itens(pedido_item_troca_id);

CREATE TRIGGER pedido_itens_exigir_estoque_estado_insert
BEFORE INSERT ON pedido_itens
FOR EACH ROW WHEN NEW.estoque_estado IS NULL
BEGIN
  SELECT RAISE(ABORT, 'pedido_itens.estoque_estado obrigatorio');
END;

CREATE TRIGGER pedido_itens_exigir_estoque_estado_update
BEFORE UPDATE OF estoque_estado ON pedido_itens
FOR EACH ROW WHEN NEW.estoque_estado IS NULL
BEGIN
  SELECT RAISE(ABORT, 'pedido_itens.estoque_estado obrigatorio');
END;

CREATE TRIGGER pedido_pagamentos_reativar_reserva_por_item
AFTER INSERT ON pedido_pagamentos
FOR EACH ROW
WHEN NEW.metodo = 'PIX_MP'
 AND NEW.origem = 'ADMIN'
 AND NEW.status = 'PENDENTE'
 AND (SELECT p.reserva_status FROM pedidos p WHERE p.id = NEW.pedido_id) = 'ATIVA'
BEGIN
  UPDATE pedido_itens
  SET estoque_estado = 'RESERVADO', estoque_reservado_em = CURRENT_TIMESTAMP
  WHERE pedido_id = NEW.pedido_id
    AND status_item = 'ATIVO'
    AND produto_id IS NOT NULL
    AND estoque_estado IN ('SEM_RESERVA', 'LIBERADO')
    AND (SELECT pr.estoque_reservado FROM produtos pr
         WHERE pr.id = pedido_itens.produto_id) >=
        COALESCE((SELECT SUM(res.quantidade) FROM pedido_itens res
                  WHERE res.produto_id = pedido_itens.produto_id
                    AND res.status_item IN ('ATIVO', 'TROCA_PENDENTE')
                    AND res.estoque_estado = 'RESERVADO'), 0)
        +
        COALESCE((SELECT SUM(pend.quantidade) FROM pedido_itens pend
                  WHERE pend.pedido_id = NEW.pedido_id
                    AND pend.produto_id = pedido_itens.produto_id
                    AND pend.status_item = 'ATIVO'
                    AND pend.estoque_estado IN ('SEM_RESERVA', 'LIBERADO')), 0);
END;

CREATE INDEX idx_pedido_item_trocas_pedido ON pedido_item_trocas(pedido_id, criado_em);
CREATE INDEX idx_pedido_item_trocas_origem ON pedido_item_trocas(item_origem_id, criado_em);
CREATE INDEX idx_pedido_item_trocas_destino ON pedido_item_trocas(item_destino_id);
CREATE UNIQUE INDEX uq_pedido_item_trocas_efetiva
  ON pedido_item_trocas(item_origem_id) WHERE status <> 'FALHOU';

CREATE TRIGGER pedido_item_trocas_validar_insert
BEFORE INSERT ON pedido_item_trocas
FOR EACH ROW WHEN
  NOT EXISTS (
    SELECT 1 FROM pedido_itens pi
    WHERE pi.id = NEW.item_origem_id AND pi.pedido_id = NEW.pedido_id
  )
BEGIN
  SELECT RAISE(ABORT, 'troca_item_origem_invalido');
END;

CREATE TRIGGER pedido_item_trocas_validar_destino_update
BEFORE UPDATE OF item_destino_id ON pedido_item_trocas
FOR EACH ROW WHEN NEW.item_destino_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM pedido_itens pi
  WHERE pi.id = NEW.item_destino_id
    AND pi.pedido_id = NEW.pedido_id
    AND pi.produto_id = NEW.produto_destino_id
    AND pi.quantidade = NEW.quantidade_destino
    AND pi.pedido_item_troca_id = NEW.id
)
BEGIN
  SELECT RAISE(ABORT, 'troca_item_destino_invalido');
END;

CREATE TRIGGER pedido_item_trocas_nao_desvincular_pendente
BEFORE UPDATE OF item_destino_id ON pedido_item_trocas
FOR EACH ROW WHEN OLD.item_destino_id IS NOT NULL AND NEW.item_destino_id IS NULL
  AND EXISTS (
    SELECT 1 FROM pedido_itens pi
    WHERE pi.id = OLD.item_destino_id AND pi.status_item = 'TROCA_PENDENTE'
  )
BEGIN
  SELECT RAISE(ABORT, 'troca_destino_pendente_obrigatorio');
END;

CREATE TRIGGER pedido_itens_troca_pendente_validar_insert
BEFORE INSERT ON pedido_itens
FOR EACH ROW WHEN NEW.status_item='TROCA_PENDENTE' AND NOT EXISTS(
  SELECT 1 FROM pedido_item_trocas t
  WHERE t.id=NEW.pedido_item_troca_id AND t.pedido_id=NEW.pedido_id
    AND t.produto_destino_id=NEW.produto_id AND t.quantidade_destino=NEW.quantidade
    AND t.item_destino_id IS NULL AND t.status IN ('SOLICITADA','AGUARDANDO_REEMBOLSO')
)
BEGIN
  SELECT RAISE(ABORT, 'troca_pendente_sem_troca');
END;

CREATE TRIGGER pedido_itens_troca_pendente_validar_update
BEFORE UPDATE OF status_item, pedido_item_troca_id ON pedido_itens
FOR EACH ROW WHEN NEW.status_item='TROCA_PENDENTE' AND NOT EXISTS(
  SELECT 1 FROM pedido_item_trocas t
  WHERE t.id=NEW.pedido_item_troca_id AND t.pedido_id=NEW.pedido_id
    AND t.produto_destino_id=NEW.produto_id AND t.quantidade_destino=NEW.quantidade
    AND (t.item_destino_id IS NULL OR t.item_destino_id=NEW.id)
    AND t.status IN ('SOLICITADA','AGUARDANDO_REEMBOLSO')
)
BEGIN
  SELECT RAISE(ABORT, 'troca_pendente_sem_troca');
END;

CREATE TRIGGER pedido_item_cancelamentos_validar_pedido_insert
BEFORE INSERT ON pedido_item_cancelamentos
FOR EACH ROW WHEN NOT EXISTS (
  SELECT 1 FROM pedido_itens pi
  WHERE pi.id = NEW.pedido_item_id AND pi.pedido_id = NEW.pedido_id
)
BEGIN
  SELECT RAISE(ABORT, 'cancelamento_item_fora_do_pedido');
END;

CREATE TRIGGER pedido_item_cancelamentos_validar_pedido_update
BEFORE UPDATE OF pedido_id, pedido_item_id ON pedido_item_cancelamentos
FOR EACH ROW WHEN NOT EXISTS (
  SELECT 1 FROM pedido_itens pi
  WHERE pi.id = NEW.pedido_item_id AND pi.pedido_id = NEW.pedido_id
)
BEGIN
  SELECT RAISE(ABORT, 'cancelamento_item_fora_do_pedido');
END;

CREATE TABLE pedido_item_troca_reembolso_alocacoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reembolso_id INTEGER NOT NULL,
  pagamento_alocacao_id INTEGER NOT NULL,
  pedido_item_troca_id INTEGER NOT NULL,
  valor_centavos INTEGER NOT NULL CHECK (valor_centavos > 0),
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (reembolso_id) REFERENCES pedido_reembolsos(id) ON DELETE RESTRICT,
  FOREIGN KEY (pagamento_alocacao_id) REFERENCES pedido_pagamento_alocacoes(id) ON DELETE RESTRICT,
  FOREIGN KEY (pedido_item_troca_id) REFERENCES pedido_item_trocas(id) ON DELETE RESTRICT,
  UNIQUE (reembolso_id, pagamento_alocacao_id)
);

CREATE INDEX idx_troca_reembolso_alocacoes_reembolso
  ON pedido_item_troca_reembolso_alocacoes(reembolso_id);
CREATE INDEX idx_troca_reembolso_alocacoes_pagamento
  ON pedido_item_troca_reembolso_alocacoes(pagamento_alocacao_id);
CREATE INDEX idx_troca_reembolso_alocacoes_troca
  ON pedido_item_troca_reembolso_alocacoes(pedido_item_troca_id);

CREATE TRIGGER pedido_item_troca_reembolsos_validar_insert
BEFORE INSERT ON pedido_item_troca_reembolso_alocacoes
FOR EACH ROW WHEN
  NOT EXISTS (
    SELECT 1
    FROM pedido_reembolsos r
    JOIN pedido_pagamento_alocacoes a ON a.id = NEW.pagamento_alocacao_id
    JOIN pedido_item_trocas t ON t.id = NEW.pedido_item_troca_id
    WHERE r.id = NEW.reembolso_id
      AND r.pedido_id = t.pedido_id
      AND r.pagamento_id = a.pagamento_id
      AND a.pedido_item_id = t.item_origem_id
  )
  OR NEW.valor_centavos + COALESCE((
    SELECT SUM(x.valor_centavos) FROM (
      SELECT valor_centavos FROM pedido_reembolso_alocacoes
      WHERE pagamento_alocacao_id = NEW.pagamento_alocacao_id
      UNION ALL
      SELECT valor_centavos FROM pedido_item_troca_reembolso_alocacoes
      WHERE pagamento_alocacao_id = NEW.pagamento_alocacao_id
    ) x
  ), 0) > (SELECT valor_centavos FROM pedido_pagamento_alocacoes WHERE id = NEW.pagamento_alocacao_id)
  OR NEW.valor_centavos + COALESCE((
    SELECT SUM(x.valor_centavos) FROM (
      SELECT valor_centavos FROM pedido_reembolso_alocacoes WHERE reembolso_id = NEW.reembolso_id
      UNION ALL
      SELECT valor_centavos FROM pedido_item_troca_reembolso_alocacoes WHERE reembolso_id = NEW.reembolso_id
    ) x
  ), 0) > (SELECT valor_centavos FROM pedido_reembolsos WHERE id = NEW.reembolso_id)
BEGIN
  SELECT RAISE(ABORT, 'troca_reembolso_alocacao_inconsistente');
END;

CREATE TRIGGER pedido_item_troca_reembolsos_validar_update
BEFORE UPDATE OF reembolso_id, pagamento_alocacao_id,
  pedido_item_troca_id, valor_centavos ON pedido_item_troca_reembolso_alocacoes
FOR EACH ROW WHEN
  NOT EXISTS (
    SELECT 1
    FROM pedido_reembolsos r
    JOIN pedido_pagamento_alocacoes a ON a.id = NEW.pagamento_alocacao_id
    JOIN pedido_item_trocas t ON t.id = NEW.pedido_item_troca_id
    WHERE r.id = NEW.reembolso_id AND r.pedido_id = t.pedido_id
      AND r.pagamento_id = a.pagamento_id AND a.pedido_item_id = t.item_origem_id
  )
  OR NEW.valor_centavos
     + COALESCE((SELECT SUM(valor_centavos) FROM pedido_reembolso_alocacoes
                 WHERE pagamento_alocacao_id = NEW.pagamento_alocacao_id), 0)
     + COALESCE((SELECT SUM(valor_centavos) FROM pedido_item_troca_reembolso_alocacoes
                 WHERE pagamento_alocacao_id = NEW.pagamento_alocacao_id AND id <> OLD.id), 0)
     > (SELECT valor_centavos FROM pedido_pagamento_alocacoes WHERE id = NEW.pagamento_alocacao_id)
  OR NEW.valor_centavos
     + COALESCE((SELECT SUM(valor_centavos) FROM pedido_reembolso_alocacoes
                 WHERE reembolso_id = NEW.reembolso_id), 0)
     + COALESCE((SELECT SUM(valor_centavos) FROM pedido_item_troca_reembolso_alocacoes
                 WHERE reembolso_id = NEW.reembolso_id AND id <> OLD.id), 0)
     > (SELECT valor_centavos FROM pedido_reembolsos WHERE id = NEW.reembolso_id)
BEGIN
  SELECT RAISE(ABORT, 'troca_reembolso_alocacao_inconsistente');
END;

CREATE TRIGGER pedido_reembolso_alocacoes_validar_insert
BEFORE INSERT ON pedido_reembolso_alocacoes
FOR EACH ROW WHEN
  NOT EXISTS (
    SELECT 1
    FROM pedido_reembolsos r
    JOIN pedido_pagamento_alocacoes a ON a.id = NEW.pagamento_alocacao_id
    JOIN pedido_itens pi ON pi.id = a.pedido_item_id
    JOIN pedido_item_cancelamentos c ON c.id = NEW.pedido_item_cancelamento_id
    WHERE r.id = NEW.reembolso_id AND r.pagamento_id = a.pagamento_id
      AND r.pedido_id = pi.pedido_id AND r.pedido_id = c.pedido_id
      AND a.pedido_item_id = c.pedido_item_id
  )
  OR NEW.valor_centavos
     + COALESCE((SELECT SUM(valor_centavos) FROM pedido_reembolso_alocacoes
                 WHERE pagamento_alocacao_id = NEW.pagamento_alocacao_id), 0)
     + COALESCE((SELECT SUM(valor_centavos) FROM pedido_item_troca_reembolso_alocacoes
                 WHERE pagamento_alocacao_id = NEW.pagamento_alocacao_id), 0)
     > (SELECT valor_centavos FROM pedido_pagamento_alocacoes WHERE id = NEW.pagamento_alocacao_id)
  OR NEW.valor_centavos
     + COALESCE((SELECT SUM(valor_centavos) FROM pedido_reembolso_alocacoes
                 WHERE reembolso_id = NEW.reembolso_id), 0)
     + COALESCE((SELECT SUM(valor_centavos) FROM pedido_item_troca_reembolso_alocacoes
                 WHERE reembolso_id = NEW.reembolso_id), 0)
     > (SELECT valor_centavos FROM pedido_reembolsos WHERE id = NEW.reembolso_id)
BEGIN
  SELECT RAISE(ABORT, 'reembolso_alocacao_inconsistente');
END;

CREATE TRIGGER pedido_reembolso_alocacoes_validar_update
BEFORE UPDATE OF reembolso_id, pagamento_alocacao_id,
  pedido_item_cancelamento_id, valor_centavos ON pedido_reembolso_alocacoes
FOR EACH ROW WHEN
  NOT EXISTS (
    SELECT 1
    FROM pedido_reembolsos r
    JOIN pedido_pagamento_alocacoes a ON a.id = NEW.pagamento_alocacao_id
    JOIN pedido_itens pi ON pi.id = a.pedido_item_id
    JOIN pedido_item_cancelamentos c ON c.id = NEW.pedido_item_cancelamento_id
    WHERE r.id = NEW.reembolso_id AND r.pagamento_id = a.pagamento_id
      AND r.pedido_id = pi.pedido_id AND r.pedido_id = c.pedido_id
      AND a.pedido_item_id = c.pedido_item_id
  )
  OR NEW.valor_centavos
     + COALESCE((SELECT SUM(valor_centavos) FROM pedido_reembolso_alocacoes
                 WHERE pagamento_alocacao_id = NEW.pagamento_alocacao_id AND id <> OLD.id), 0)
     + COALESCE((SELECT SUM(valor_centavos) FROM pedido_item_troca_reembolso_alocacoes
                 WHERE pagamento_alocacao_id = NEW.pagamento_alocacao_id), 0)
     > (SELECT valor_centavos FROM pedido_pagamento_alocacoes WHERE id = NEW.pagamento_alocacao_id)
  OR NEW.valor_centavos
     + COALESCE((SELECT SUM(valor_centavos) FROM pedido_reembolso_alocacoes
                 WHERE reembolso_id = NEW.reembolso_id AND id <> OLD.id), 0)
     + COALESCE((SELECT SUM(valor_centavos) FROM pedido_item_troca_reembolso_alocacoes
                 WHERE reembolso_id = NEW.reembolso_id), 0)
     > (SELECT valor_centavos FROM pedido_reembolsos WHERE id = NEW.reembolso_id)
BEGIN
  SELECT RAISE(ABORT, 'reembolso_alocacao_inconsistente');
END;

-- Impede que novas alocacoes de cancelamento ignorem valores ja consumidos
-- por uma troca. Os triggers da 0018 continuam validando o proprio dominio.
CREATE TRIGGER pedido_pagamento_alocacoes_preservar_reembolsos_update
BEFORE UPDATE OF pagamento_id, pedido_item_id, valor_centavos ON pedido_pagamento_alocacoes
FOR EACH ROW WHEN
  NEW.valor_centavos < (
    COALESCE((SELECT SUM(valor_centavos) FROM pedido_reembolso_alocacoes
              WHERE pagamento_alocacao_id = OLD.id), 0)
    + COALESCE((SELECT SUM(valor_centavos) FROM pedido_item_troca_reembolso_alocacoes
                WHERE pagamento_alocacao_id = OLD.id), 0)
  )
  OR EXISTS (
    SELECT 1 FROM pedido_reembolso_alocacoes ra
    JOIN pedido_reembolsos r ON r.id = ra.reembolso_id
    JOIN pedido_item_cancelamentos c ON c.id = ra.pedido_item_cancelamento_id
    WHERE ra.pagamento_alocacao_id = OLD.id
      AND (NEW.pagamento_id <> r.pagamento_id OR NEW.pedido_item_id <> c.pedido_item_id)
  )
  OR EXISTS (
    SELECT 1 FROM pedido_item_troca_reembolso_alocacoes ra
    JOIN pedido_reembolsos r ON r.id = ra.reembolso_id
    JOIN pedido_item_trocas t ON t.id = ra.pedido_item_troca_id
    WHERE ra.pagamento_alocacao_id = OLD.id
      AND (NEW.pagamento_id <> r.pagamento_id OR NEW.pedido_item_id <> t.item_origem_id)
  )
BEGIN
  SELECT RAISE(ABORT, 'reembolso_alocacao_inconsistente');
END;

CREATE TRIGGER pedido_item_cancelamentos_preservar_reembolsos_update
BEFORE UPDATE OF pedido_id, pedido_item_id ON pedido_item_cancelamentos
FOR EACH ROW WHEN EXISTS (
  SELECT 1 FROM pedido_reembolso_alocacoes ra
  JOIN pedido_pagamento_alocacoes a ON a.id = ra.pagamento_alocacao_id
  JOIN pedido_reembolsos r ON r.id = ra.reembolso_id
  WHERE ra.pedido_item_cancelamento_id = OLD.id
    AND (NEW.pedido_item_id <> a.pedido_item_id OR NEW.pedido_id <> r.pedido_id)
)
BEGIN
  SELECT RAISE(ABORT, 'reembolso_alocacao_inconsistente');
END;

INSERT INTO pedido_pagamento_alocacoes(id,pagamento_id,pedido_item_id,valor_centavos,criado_em)
SELECT id,pagamento_id,pedido_item_id,valor_centavos,criado_em FROM _0019_pagamento_alocacoes;

INSERT INTO pedido_item_cancelamentos(
  id,pedido_id,pedido_item_id,status,valor_item_centavos,
  valor_pago_associado_centavos,valor_reembolso_necessario_centavos,
  estoque_acao,motivo,registrado_por_usuario_id,snapshot_financeiro,criado_em,concluido_em
)
SELECT id,pedido_id,pedido_item_id,status,valor_item_centavos,
  valor_pago_associado_centavos,valor_reembolso_necessario_centavos,
  estoque_acao,motivo,registrado_por_usuario_id,snapshot_financeiro,criado_em,concluido_em
FROM _0019_cancelamentos;

INSERT INTO pedido_reembolso_alocacoes(
  id,reembolso_id,pagamento_alocacao_id,pedido_item_cancelamento_id,valor_centavos,criado_em
)
SELECT id,reembolso_id,pagamento_alocacao_id,pedido_item_cancelamento_id,valor_centavos,criado_em
FROM _0019_reembolso_alocacoes;

-- ITEM_TROCA_ADMIN aponta para a troca exata. Todas as operacoes antigas
-- preservam ids, payloads, fases, timestamps e referencias; a coluna nova e
-- NULL para elas.
CREATE TABLE pedido_operacoes__novo (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  operation_key TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN (
    'CHECKOUT_SITE', 'PEDIDO_ADMIN', 'PAGAMENTO_ADMIN', 'REFUND_ADMIN',
    'PIX_ADMIN', 'PIX_ADMIN_REGENERACAO', 'ITEM_ADICAO_ADMIN',
    'ITEM_CANCELAMENTO_ADMIN', 'ITEM_TROCA_ADMIN'
  )),
  escopo TEXT NOT NULL CHECK (escopo IN ('SITE', 'ADMIN')),
  ator_usuario_id INTEGER,
  fingerprint_versao INTEGER NOT NULL,
  fingerprint TEXT NOT NULL,
  fase TEXT NOT NULL DEFAULT 'LOCAL_CRIADA' CHECK (fase IN (
    'LOCAL_CRIADA', 'ENVIO_INCONCLUSIVO', 'REMOTO_CONHECIDO', 'CONCLUIDA', 'RECUSADA'
  )),
  pedido_id INTEGER,
  pagamento_id INTEGER,
  reembolso_id INTEGER,
  pedido_item_id INTEGER,
  pedido_item_cancelamento_id INTEGER,
  pedido_item_troca_id INTEGER,
  resultado TEXT,
  erro TEXT,
  mp_idempotency_key TEXT,
  mp_request TEXT,
  mp_payment_id TEXT,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE CASCADE,
  FOREIGN KEY (pagamento_id) REFERENCES pedido_pagamentos(id) ON DELETE SET NULL,
  FOREIGN KEY (reembolso_id) REFERENCES pedido_reembolsos(id) ON DELETE SET NULL,
  FOREIGN KEY (pedido_item_id) REFERENCES pedido_itens(id) ON DELETE RESTRICT,
  FOREIGN KEY (pedido_item_cancelamento_id) REFERENCES pedido_item_cancelamentos(id) ON DELETE RESTRICT,
  FOREIGN KEY (pedido_item_troca_id) REFERENCES pedido_item_trocas(id) ON DELETE RESTRICT,
  FOREIGN KEY (ator_usuario_id) REFERENCES usuarios_admin(id) ON DELETE SET NULL
);

INSERT INTO pedido_operacoes__novo (
  id, operation_key, tipo, escopo, ator_usuario_id,
  fingerprint_versao, fingerprint, fase,
  pedido_id, pagamento_id, reembolso_id, pedido_item_id,
  pedido_item_cancelamento_id, pedido_item_troca_id,
  resultado, erro, mp_idempotency_key, mp_request, mp_payment_id,
  criado_em, atualizado_em
)
SELECT
  id, operation_key, tipo, escopo, ator_usuario_id,
  fingerprint_versao, fingerprint, fase,
  pedido_id, pagamento_id, reembolso_id, pedido_item_id,
  pedido_item_cancelamento_id, NULL,
  resultado, erro, mp_idempotency_key, mp_request, mp_payment_id,
  criado_em, atualizado_em
FROM _0019_operacoes;

DROP TABLE pedido_operacoes;
ALTER TABLE pedido_operacoes__novo RENAME TO pedido_operacoes;

CREATE UNIQUE INDEX uq_pedido_operacoes_key ON pedido_operacoes(operation_key);
CREATE INDEX idx_pedido_operacoes_pedido ON pedido_operacoes(pedido_id, criado_em);
CREATE INDEX idx_pedido_operacoes_fase ON pedido_operacoes(fase, atualizado_em);
CREATE INDEX idx_pedido_operacoes_item ON pedido_operacoes(pedido_item_id, criado_em);
CREATE INDEX idx_pedido_operacoes_item_cancelamento
  ON pedido_operacoes(pedido_item_cancelamento_id, criado_em);
CREATE INDEX idx_pedido_operacoes_item_troca
  ON pedido_operacoes(pedido_item_troca_id, criado_em);

DROP TABLE _0019_pagamento_alocacoes;
DROP TABLE _0019_cancelamentos;
DROP TABLE _0019_reembolso_alocacoes;
DROP TABLE _0019_operacoes;

PRAGMA defer_foreign_keys = OFF;
