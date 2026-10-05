/// <reference types="@cloudflare/workers-types" />

// Despesas itemizadas do negócio — domínio inteiramente separado do ledger
// de pedidos (pedido_pagamentos/pedido_reembolsos/pedido_operacoes/
// pedido_item_trocas/estoque). Este arquivo nunca escreve em nenhuma
// dessas tabelas.

import {
  deMilesimos,
  type DespesaCategoria,
  type DespesaUnidade,
  type DespesaStatus
} from "../../shared/despesas";
import type { DespesaItemNormalizado } from "./despesasValidation";

export * from "./despesasValidation";

interface DespesaHeaderRow {
  id: number;
  fornecedor: string;
  data_competencia: string;
  observacao: string;
  status: DespesaStatus;
  total_centavos: number;
  criado_por_usuario_id: number;
  criado_em: string;
  atualizado_em: string;
  cancelado_em: string | null;
  cancelado_por_usuario_id: number | null;
}

interface DespesaItemRow {
  id: number;
  despesa_id: number;
  descricao: string;
  categoria: DespesaCategoria;
  quantidade_milesimos: number;
  unidade: DespesaUnidade;
  valor_unitario_centavos: number;
  valor_total_centavos: number;
  criado_em: string;
}

export interface DespesaItemView {
  id: number;
  descricao: string;
  categoria: DespesaCategoria;
  quantidade: number;
  unidade: DespesaUnidade;
  valorUnitarioCentavos: number;
  valorTotalCentavos: number;
}

export interface DespesaView {
  id: number;
  fornecedor: string;
  dataCompetencia: string;
  observacao: string;
  status: DespesaStatus;
  totalCentavos: number;
  itemCount: number;
  itens: DespesaItemView[];
  criadoPorUsuarioId: number;
  criadoEm: string;
  atualizadoEm: string;
  canceladoEm: string | null;
  canceladoPorUsuarioId: number | null;
}

function itemView(row: DespesaItemRow): DespesaItemView {
  return {
    id: Number(row.id),
    descricao: row.descricao,
    categoria: row.categoria,
    quantidade: deMilesimos(Number(row.quantidade_milesimos)),
    unidade: row.unidade,
    valorUnitarioCentavos: Number(row.valor_unitario_centavos),
    valorTotalCentavos: Number(row.valor_total_centavos)
  };
}

function headerView(row: DespesaHeaderRow, itens: DespesaItemView[]): DespesaView {
  return {
    id: Number(row.id),
    fornecedor: row.fornecedor,
    dataCompetencia: row.data_competencia,
    observacao: row.observacao,
    status: row.status,
    totalCentavos: Number(row.total_centavos),
    itemCount: itens.length,
    itens,
    criadoPorUsuarioId: Number(row.criado_por_usuario_id),
    criadoEm: row.criado_em,
    atualizadoEm: row.atualizado_em,
    canceladoEm: row.cancelado_em,
    canceladoPorUsuarioId:
      row.cancelado_por_usuario_id === null ? null : Number(row.cancelado_por_usuario_id)
  };
}

export async function obterDespesa(db: D1Database, id: number): Promise<DespesaView | null> {
  const header = await db
    .prepare(`SELECT * FROM despesas WHERE id = ?`)
    .bind(id)
    .first<DespesaHeaderRow>();
  if (!header) return null;
  const { results } = await db
    .prepare(`SELECT * FROM despesa_itens WHERE despesa_id = ? ORDER BY id ASC`)
    .bind(id)
    .all<DespesaItemRow>();
  return headerView(header, (results ?? []).map(itemView));
}

export type CriarDespesaResultado =
  { ok: true; despesa: DespesaView } | { ok: false; erro: string };

// Cabeçalho + itens nascem no MESMO batch atômico: nunca existe uma despesa
// sem item, nem um item órfão. `(SELECT MAX(id) FROM despesas)` referencia o
// cabeçalho recém-inserido dentro do próprio batch — seguro porque um
// batch D1 é uma única transação (sem outro escritor podendo intercalar um
// INSERT concorrente em `despesas` no meio dela).
export async function criarDespesa(
  db: D1Database,
  params: {
    fornecedor: string;
    dataCompetencia: string;
    observacao: string;
    itens: DespesaItemNormalizado[];
    usuarioId: number;
  }
): Promise<CriarDespesaResultado> {
  const totalCentavos = params.itens.reduce((soma, item) => soma + item.valorTotalCentavos, 0);

  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO despesas(
        fornecedor, data_competencia, observacao, status, total_centavos, criado_por_usuario_id)
      VALUES(?, ?, ?, 'ATIVA', ?, ?)`
      )
      .bind(
        params.fornecedor,
        params.dataCompetencia,
        params.observacao,
        totalCentavos,
        params.usuarioId
      ),
    ...params.itens.map(item =>
      db
        .prepare(
          `INSERT INTO despesa_itens(
          despesa_id, descricao, categoria, quantidade_milesimos, unidade,
          valor_unitario_centavos, valor_total_centavos)
        SELECT (SELECT MAX(id) FROM despesas), ?, ?, ?, ?, ?, ?`
        )
        .bind(
          item.descricao,
          item.categoria,
          item.quantidadeMilesimos,
          item.unidade,
          item.valorUnitarioCentavos,
          item.valorTotalCentavos
        )
    )
  ];

  const results = await db.batch(statements);
  const despesaId = Number(results[0]?.meta?.last_row_id);
  const despesa = await obterDespesa(db, despesaId);
  if (!despesa) throw new Error("DESPESA_NAO_CRIADA");
  return { ok: true, despesa };
}

export type EditarDespesaResultado =
  | { ok: true; despesa: DespesaView }
  | { ok: false; erro: "DESPESA_NAO_ENCONTRADA" | "DESPESA_CANCELADA" };

// Reconstrói os itens dentro da mesma operação (mais simples e seguro do
// que tentar diffar item a item): apaga todos os itens atuais e insere o
// conjunto novo, sempre condicionado a `status='ATIVA'` na própria cláusula
// WHERE — se a despesa foi cancelada entre a leitura e a escrita, NENHUMA
// linha é afetada (CAS), e o sentinel final aborta o batch inteiro se por
// algum motivo a despesa ficasse sem item.
export async function editarDespesa(
  db: D1Database,
  params: {
    id: number;
    fornecedor: string;
    dataCompetencia: string;
    observacao: string;
    itens: DespesaItemNormalizado[];
  }
): Promise<EditarDespesaResultado> {
  const atual = await obterDespesa(db, params.id);
  if (!atual) return { ok: false, erro: "DESPESA_NAO_ENCONTRADA" };
  if (atual.status === "CANCELADA") return { ok: false, erro: "DESPESA_CANCELADA" };

  const totalCentavos = params.itens.reduce((soma, item) => soma + item.valorTotalCentavos, 0);

  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `DELETE FROM despesa_itens WHERE despesa_id = ?
      AND EXISTS(SELECT 1 FROM despesas WHERE id = ? AND status = 'ATIVA')`
      )
      .bind(params.id, params.id),
    ...params.itens.map(item =>
      db
        .prepare(
          `INSERT INTO despesa_itens(
          despesa_id, descricao, categoria, quantidade_milesimos, unidade,
          valor_unitario_centavos, valor_total_centavos)
        SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS(SELECT 1 FROM despesas WHERE id = ? AND status = 'ATIVA')`
        )
        .bind(
          params.id,
          item.descricao,
          item.categoria,
          item.quantidadeMilesimos,
          item.unidade,
          item.valorUnitarioCentavos,
          item.valorTotalCentavos,
          params.id
        )
    ),
    db
      .prepare(
        `UPDATE despesas SET fornecedor = ?, data_competencia = ?, observacao = ?,
        total_centavos = ?, atualizado_em = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'ATIVA'`
      )
      .bind(params.fornecedor, params.dataCompetencia, params.observacao, totalCentavos, params.id),
    // Sentinela: se por qualquer motivo a despesa ficasse ATIVA sem item
    // nenhum, este UPDATE viola o CHECK de total_centavos>=0 e reverte tudo.
    db
      .prepare(
        `UPDATE despesas SET total_centavos = -1
      WHERE id = ? AND status = 'ATIVA' AND NOT EXISTS(SELECT 1 FROM despesa_itens WHERE despesa_id = ?)`
      )
      .bind(params.id, params.id)
  ];

  try {
    await db.batch(statements);
  } catch (error) {
    const recheck = await obterDespesa(db, params.id);
    if (recheck?.status === "CANCELADA") return { ok: false, erro: "DESPESA_CANCELADA" };
    throw error;
  }

  const atualizada = await obterDespesa(db, params.id);
  if (!atualizada) return { ok: false, erro: "DESPESA_NAO_ENCONTRADA" };
  if (atualizada.status === "CANCELADA") return { ok: false, erro: "DESPESA_CANCELADA" };
  return { ok: true, despesa: atualizada };
}

export type CancelarDespesaResultado =
  | { ok: true; despesa: DespesaView; replay: boolean }
  | { ok: false; erro: "DESPESA_NAO_ENCONTRADA" };

// Idempotente: cancelar uma despesa já CANCELADA é um no-op que devolve o
// mesmo resultado lógico (replay), nunca um erro nem um segundo registro de
// cancelamento.
export async function cancelarDespesa(
  db: D1Database,
  params: {
    id: number;
    usuarioId: number;
  }
): Promise<CancelarDespesaResultado> {
  const atual = await obterDespesa(db, params.id);
  if (!atual) return { ok: false, erro: "DESPESA_NAO_ENCONTRADA" };
  if (atual.status === "CANCELADA") return { ok: true, despesa: atual, replay: true };

  await db
    .prepare(
      `UPDATE despesas
    SET status = 'CANCELADA', cancelado_em = CURRENT_TIMESTAMP, cancelado_por_usuario_id = ?,
        atualizado_em = CURRENT_TIMESTAMP
    WHERE id = ? AND status = 'ATIVA'`
    )
    .bind(params.usuarioId, params.id)
    .run();

  const atualizada = await obterDespesa(db, params.id);
  if (!atualizada) return { ok: false, erro: "DESPESA_NAO_ENCONTRADA" };
  return { ok: true, despesa: atualizada, replay: false };
}

export interface DespesaListItem {
  id: number;
  fornecedor: string;
  dataCompetencia: string;
  status: DespesaStatus;
  totalCentavos: number;
  itemCount: number;
}

interface DespesaListRow {
  id: number;
  fornecedor: string;
  data_competencia: string;
  status: DespesaStatus;
  total_centavos: number;
  item_count: number;
}

export type StatusFiltro = "TODOS" | DespesaStatus;

export async function listarDespesas(
  db: D1Database,
  params: {
    desde: string;
    ate: string;
    status: StatusFiltro;
    search: string;
  }
): Promise<DespesaListItem[]> {
  const filtros = ["d.data_competencia BETWEEN ? AND ?"];
  const args: unknown[] = [params.desde, params.ate];
  if (params.status !== "TODOS") {
    filtros.push("d.status = ?");
    args.push(params.status);
  }
  if (params.search) {
    filtros.push(`(d.fornecedor LIKE ? OR EXISTS(
      SELECT 1 FROM despesa_itens di WHERE di.despesa_id = d.id AND di.descricao LIKE ?
    ))`);
    args.push(`%${params.search}%`, `%${params.search}%`);
  }

  const { results } = await db
    .prepare(
      `
    SELECT d.id, d.fornecedor, d.data_competencia, d.status, d.total_centavos,
      (SELECT COUNT(*) FROM despesa_itens di WHERE di.despesa_id = d.id) AS item_count
    FROM despesas d
    WHERE ${filtros.join(" AND ")}
    ORDER BY d.data_competencia DESC, d.id DESC
  `
    )
    .bind(...args)
    .all<DespesaListRow>();

  return (results ?? []).map(row => ({
    id: Number(row.id),
    fornecedor: row.fornecedor,
    dataCompetencia: row.data_competencia,
    status: row.status,
    totalCentavos: Number(row.total_centavos),
    itemCount: Number(row.item_count)
  }));
}

export interface CategoriaResumo {
  categoria: DespesaCategoria;
  valorCentavos: number;
  percentual: number;
}

export interface ItemRankingResumo {
  descricao: string;
  valorCentavos: number;
}

export interface ResumoDespesas {
  totalCentavos: number;
  porCategoria: CategoriaResumo[];
  rankingItens: ItemRankingResumo[];
}

// Resumo financeiro do período: sempre só despesas ATIVAS (uma CANCELADA
// nunca aparece aqui, independente do filtro de status da tabela/listagem).
export async function getResumoDespesas(
  db: D1Database,
  params: {
    desde: string;
    ate: string;
  }
): Promise<ResumoDespesas> {
  const porCategoriaResult = await db
    .prepare(
      `
    SELECT di.categoria AS categoria, SUM(di.valor_total_centavos) AS valor_centavos
    FROM despesa_itens di JOIN despesas d ON d.id = di.despesa_id
    WHERE d.status = 'ATIVA' AND d.data_competencia BETWEEN ? AND ?
    GROUP BY di.categoria
    ORDER BY valor_centavos DESC
  `
    )
    .bind(params.desde, params.ate)
    .all<{ categoria: DespesaCategoria; valor_centavos: number }>();

  const linhas = porCategoriaResult.results ?? [];
  const totalCentavos = linhas.reduce((soma, linha) => soma + Number(linha.valor_centavos), 0);
  const porCategoria: CategoriaResumo[] = linhas.map(linha => ({
    categoria: linha.categoria,
    valorCentavos: Number(linha.valor_centavos),
    percentual: totalCentavos === 0 ? 0 : (Number(linha.valor_centavos) / totalCentavos) * 100
  }));

  // Agrupamento por nome de item é trim + case-insensitive (NUNCA fuzzy):
  // "Ovos" e "ovos " somam juntos; "Ovo" e "Ovos" continuam separados. O
  // nome exibido é o da grafia mais recente daquele grupo.
  const rankingResult = await db
    .prepare(
      `
    WITH agrupado AS (
      SELECT LOWER(TRIM(di.descricao)) AS chave, SUM(di.valor_total_centavos) AS valor_centavos,
        MAX(di.id) AS ultimo_id
      FROM despesa_itens di JOIN despesas d ON d.id = di.despesa_id
      WHERE d.status = 'ATIVA' AND d.data_competencia BETWEEN ? AND ?
      GROUP BY chave
    )
    SELECT di.descricao AS descricao, a.valor_centavos AS valor_centavos
    FROM agrupado a JOIN despesa_itens di ON di.id = a.ultimo_id
    ORDER BY a.valor_centavos DESC, di.descricao COLLATE NOCASE ASC
    LIMIT 10
  `
    )
    .bind(params.desde, params.ate)
    .all<{ descricao: string; valor_centavos: number }>();

  return {
    totalCentavos,
    porCategoria,
    rankingItens: (rankingResult.results ?? []).map(row => ({
      descricao: row.descricao,
      valorCentavos: Number(row.valor_centavos)
    }))
  };
}
