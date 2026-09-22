-- Despesas itemizadas do negócio (compras de insumos, embalagens, etc.),
-- para "Lucro estimado" no admin: faturamento líquido existente MENOS
-- despesas ATIVAS. Domínio inteiramente separado do ledger de pedidos —
-- esta migration não toca pedido_pagamentos, pedido_reembolsos,
-- pedido_operacoes, pedido_item_trocas nem qualquer tabela de estoque.
--
-- Nunca hard delete: "excluir despesa" na UI cancela (status=CANCELADA),
-- preservando histórico. Uma despesa CANCELADA nunca entra em cálculo
-- nenhum e nunca pode ser editada ou reativada (garantido pelos triggers
-- abaixo, não só pela camada de aplicação).
--
-- Dinheiro sempre em centavos inteiros. Quantidade nunca em float: usa
-- `quantidade_milesimos` (quantidade × 1000) para representar até 3 casas
-- decimais sem erro de ponto flutuante — 1 un = 1000, 1,5 kg = 1500,
-- 0,5 kg = 500, 30 un = 30000. O total do item é sempre derivado no
-- servidor (quantidade × valor unitário, arredondado) e o total da despesa
-- é sempre `SUM(despesa_itens.valor_total_centavos)`; nenhum dos dois é
-- aceito como entrada do cliente.
--
-- Modelagem deliberadamente NÃO inclui estoque de insumos, ficha técnica,
-- CMV por produto ou baixa automática (fora de escopo desta versão) — mas
-- nada aqui impede adicionar isso depois: `despesa_itens.descricao` é texto
-- livre, sem vínculo com nenhuma tabela de produto/insumo.

CREATE TABLE despesas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fornecedor TEXT NOT NULL DEFAULT '',
  data_competencia TEXT NOT NULL,
  observacao TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ATIVA' CHECK (status IN ('ATIVA', 'CANCELADA')),
  -- Denormalizado a partir de despesa_itens para listagem rápida sem JOIN;
  -- recalculado pelo servidor a cada escrita de item, nunca aceito do cliente.
  total_centavos INTEGER NOT NULL DEFAULT 0 CHECK (total_centavos >= 0),
  criado_por_usuario_id INTEGER NOT NULL,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  cancelado_em TEXT,
  cancelado_por_usuario_id INTEGER,
  CHECK (data_competencia GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  CHECK (length(fornecedor) <= 200),
  CHECK (length(observacao) <= 1000),
  CHECK ((status = 'CANCELADA') = (cancelado_em IS NOT NULL)),
  CHECK ((status = 'CANCELADA') = (cancelado_por_usuario_id IS NOT NULL)),
  FOREIGN KEY (criado_por_usuario_id) REFERENCES usuarios_admin(id) ON DELETE RESTRICT,
  FOREIGN KEY (cancelado_por_usuario_id) REFERENCES usuarios_admin(id) ON DELETE RESTRICT
);

CREATE INDEX idx_despesas_status_data ON despesas(status, data_competencia);
CREATE INDEX idx_despesas_fornecedor ON despesas(fornecedor COLLATE NOCASE);

CREATE TABLE despesa_itens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  despesa_id INTEGER NOT NULL,
  descricao TEXT NOT NULL,
  categoria TEXT NOT NULL CHECK (categoria IN (
    'INGREDIENTES', 'EMBALAGENS', 'ENTREGA_TRANSPORTE', 'TAXAS', 'MARKETING',
    'EQUIPAMENTOS', 'MANUTENCAO', 'SERVICOS', 'OUTROS'
  )),
  -- Quantidade × 1000 (ver nota acima). > 0 sempre: item de valor zero não
  -- é uma despesa.
  quantidade_milesimos INTEGER NOT NULL CHECK (quantidade_milesimos > 0),
  unidade TEXT NOT NULL CHECK (unidade IN (
    'UN', 'KG', 'G', 'L', 'ML', 'PACOTE', 'CAIXA', 'BANDEJA', 'OUTRO'
  )),
  valor_unitario_centavos INTEGER NOT NULL CHECK (valor_unitario_centavos > 0),
  -- Derivado de quantidade_milesimos × valor_unitario_centavos ÷ 1000,
  -- arredondado pelo servidor (nunca recebido do cliente).
  valor_total_centavos INTEGER NOT NULL CHECK (valor_total_centavos > 0),
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (length(descricao) BETWEEN 1 AND 200),
  FOREIGN KEY (despesa_id) REFERENCES despesas(id) ON DELETE RESTRICT
);

CREATE INDEX idx_despesa_itens_despesa ON despesa_itens(despesa_id);
CREATE INDEX idx_despesa_itens_categoria ON despesa_itens(categoria);
CREATE INDEX idx_despesa_itens_descricao ON despesa_itens(descricao COLLATE NOCASE);

-- Trava de domínio, não só de aplicação: uma despesa CANCELADA nunca pode
-- ganhar ou perder item, e nenhuma despesa pode voltar de CANCELADA para
-- ATIVA (reativação está fora de escopo desta versão).
CREATE TRIGGER despesas_cancelada_imutavel
BEFORE UPDATE ON despesas
FOR EACH ROW WHEN OLD.status = 'CANCELADA' AND (
  NEW.fornecedor IS NOT OLD.fornecedor
  OR NEW.data_competencia IS NOT OLD.data_competencia
  OR NEW.observacao IS NOT OLD.observacao
  OR NEW.total_centavos IS NOT OLD.total_centavos
  OR NEW.status <> 'CANCELADA'
)
BEGIN
  SELECT RAISE(ABORT, 'DESPESA_CANCELADA_IMUTAVEL');
END;

CREATE TRIGGER despesa_itens_despesa_cancelada_insert
BEFORE INSERT ON despesa_itens
WHEN EXISTS (SELECT 1 FROM despesas WHERE id = NEW.despesa_id AND status = 'CANCELADA')
BEGIN
  SELECT RAISE(ABORT, 'DESPESA_CANCELADA_IMUTAVEL');
END;

CREATE TRIGGER despesa_itens_despesa_cancelada_update
BEFORE UPDATE ON despesa_itens
WHEN EXISTS (SELECT 1 FROM despesas WHERE id = OLD.despesa_id AND status = 'CANCELADA')
BEGIN
  SELECT RAISE(ABORT, 'DESPESA_CANCELADA_IMUTAVEL');
END;

CREATE TRIGGER despesa_itens_despesa_cancelada_delete
BEFORE DELETE ON despesa_itens
WHEN EXISTS (SELECT 1 FROM despesas WHERE id = OLD.despesa_id AND status = 'CANCELADA')
BEGIN
  SELECT RAISE(ABORT, 'DESPESA_CANCELADA_IMUTAVEL');
END;

PRAGMA foreign_key_check;
