/// <reference types="@cloudflare/workers-types" />

import { pedidoValidoSql } from "./pedidoValido";

// HUMAN-14 — notificações internas do admin.
//
// ARQUITETURA MÍNIMA, deliberada: nenhuma notificação é materializada. Cada
// uma é DERIVADA, na leitura, de um fato que já existe no domínio. Só o
// estado de LEITURA é persistido (`notificacao_leituras`, migration 0014).
//
// Consequências disso, todas desejadas:
//   * nenhuma segunda verdade para divergir do ledger/estoque;
//   * nenhum evento inventado — se o fato some, a notificação some junto;
//   * nenhuma fila, nenhum cron, nenhum job, nenhum push/service worker.
//
// Fora de escopo por decisão explícita: push do navegador, service worker,
// Firebase, e-mail, SMS, WhatsApp automático e som.

import { listarOperacoesInconclusivasRecentes } from "./operacoes";

export type NotificacaoTipo = "PEDIDO" | "PAGAMENTO" | "ESTOQUE" | "OPERACAO" | "TESTE";

export interface Notificacao {
  /** Identidade estável do EVENTO (não da linha de leitura). */
  chave: string;
  tipo: NotificacaoTipo;
  titulo: string;
  descricao: string;
  /** Instante do fato de origem, para ordenar e exibir "há quanto tempo". */
  em: string;
  lida: boolean;
  /** Destino real quando existe; `null` quando não há para onde levar. */
  destino: string | null;
}

/**
 * Evento derivado, ainda sem o estado de leitura. Só `listarNotificacoes`
 * combina isto com `notificacao_leituras` para produzir `Notificacao`.
 */
export type NotificacaoDerivada = Omit<Notificacao, "lida">;

// Teto por tipo e no total: a lista é um painel operacional, não um histórico.
const LIMITE_POR_TIPO = 12;
const LIMITE_TOTAL = 30;

// "Poucas unidades livres" — livre = estoque - estoque_reservado.
const ESTOQUE_BAIXO_LIMIAR = 3;

function reais(centavos: number): string {
  return `R$ ${(Number(centavos || 0) / 100).toFixed(2).replace(".", ",")}`;
}

/**
 * Pedidos aguardando ação: nasceram `NOVO` e ainda não foram movidos.
 *
 * Usa o mesmo recorte operacional da listagem administrativa (B-1): pedido de
 * balcão entra sempre; pedido do site entra quando há dinheiro confirmado.
 * Um carrinho não pago não vira notificação.
 */
async function pedidosNovos(db: D1Database): Promise<NotificacaoDerivada[]> {
  const { results } = await db
    .prepare(
      `SELECT id, cliente_nome, valor_total_centavos, criado_em
       FROM pedidos
       WHERE ${pedidoValidoSql('pedidos.id')} AND status_pedido = 'NOVO'
         AND (status_pagamento IN ('PARCIAL', 'PAGO') OR origem_pedido = 'MANUAL')
       ORDER BY criado_em DESC, id DESC
       LIMIT ?`,
    )
    .bind(LIMITE_POR_TIPO)
    .all<{ id: number; cliente_nome: string; valor_total_centavos: number; criado_em: string }>();

  return (results || []).map((p) => ({
    chave: `pedido:${p.id}:novo`,
    tipo: "PEDIDO" as const,
    titulo: "Pedido aguardando preparo",
    descricao: `RP-${p.id}${p.cliente_nome ? ` · ${p.cliente_nome}` : ""} · ${reais(p.valor_total_centavos)}`,
    em: p.criado_em,
    destino: `/admin/pedidos?pedido=${p.id}`,
  }));
}

/** Pagamentos efetivamente confirmados no ledger. */
async function pagamentosConfirmados(db: D1Database): Promise<NotificacaoDerivada[]> {
  const { results } = await db
    .prepare(
      `SELECT pp.id, pp.pedido_id, pp.metodo, pp.valor_centavos, pp.pago_em
       FROM pedido_pagamentos pp
       WHERE ${pedidoValidoSql('pp.pedido_id')} AND pp.status = 'PAGO' AND pp.pago_em IS NOT NULL
       ORDER BY pp.pago_em DESC, pp.id DESC
       LIMIT ?`,
    )
    .bind(LIMITE_POR_TIPO)
    .all<{ id: number; pedido_id: number; metodo: string; valor_centavos: number; pago_em: string }>();

  const METODO_LABEL: Record<string, string> = {
    PIX_MP: "Pix",
    PIX_EXTERNO: "Pix externo",
    CARTAO: "Cartão",
    DINHEIRO: "Dinheiro",
    A_COMBINAR: "A combinar",
  };

  return (results || []).map((p) => ({
    chave: `pagamento:${p.id}:pago`,
    tipo: "PAGAMENTO" as const,
    titulo: "Pagamento confirmado",
    descricao: `RP-${p.pedido_id} · ${reais(p.valor_centavos)} · ${METODO_LABEL[p.metodo] ?? p.metodo}`,
    em: p.pago_em,
    destino: `/admin/pedidos?pedido=${p.pedido_id}`,
  }));
}

/**
 * Estoque no limite. A chave inclui o NÍVEL, então "baixo" e "esgotado" são
 * eventos distintos: marcar "estoque baixo" como lida não esconde o
 * "esgotado" que vier depois. E repor o estoque faz a notificação sumir
 * sozinha, porque ela deixa de ser derivada.
 */
async function estoqueNoLimite(db: D1Database): Promise<NotificacaoDerivada[]> {
  const { results } = await db
    .prepare(
      `SELECT id, nome, (estoque - estoque_reservado) AS livre, atualizado_em
       FROM produtos
       WHERE ativo = 1 AND (estoque - estoque_reservado) <= ?
       ORDER BY livre ASC, nome ASC
       LIMIT ?`,
    )
    .bind(ESTOQUE_BAIXO_LIMIAR, LIMITE_POR_TIPO)
    .all<{ id: number; nome: string; livre: number; atualizado_em: string }>();

  return (results || []).map((p) => {
    const esgotado = Number(p.livre) <= 0;
    return {
      chave: `estoque:${p.id}:${esgotado ? "esgotado" : "baixo"}`,
      tipo: "ESTOQUE" as const,
      titulo: esgotado ? "Produto esgotado" : "Estoque baixo",
      descricao: esgotado
        ? `${p.nome} está sem unidades livres`
        : `${p.nome} · ${p.livre} unidade(s) livre(s)`,
      em: p.atualizado_em,
      destino: "/admin/produtos",
    };
  });
}

/**
 * Falha operacional real: cobrança cujo envio ao Mercado Pago ficou
 * inconclusivo (B-3). Reaproveita o mesmo predicado da recuperação
 * read-only — nunca uma segunda definição do que é "inconclusivo".
 */
async function operacoesInconclusivas(db: D1Database): Promise<NotificacaoDerivada[]> {
  const operacoes = await listarOperacoesInconclusivasRecentes(db, LIMITE_POR_TIPO);
  return operacoes.map((o) => ({
    chave: `operacao:${o.operation_key}`,
    tipo: "OPERACAO" as const,
    titulo: "Cobrança sem confirmação do Mercado Pago",
    descricao: o.pedido_id
      ? `RP-${o.pedido_id} · verifique antes de gerar outra`
      : "Verifique antes de gerar outra",
    em: o.atualizado_em,
    destino: o.pedido_id ? `/admin/pedidos?pedido=${o.pedido_id}` : null,
  }));
}

/**
 * Diagnóstico permanente do Admin > Loja: "Pedido de produto de teste".
 *
 * Deriva de `admin_diagnostico_eventos`, isolada de `pedidos`. Título e
 * descrição deixam explícito que é simulação; `destino: null` de propósito
 * — nunca aponta para um `/admin/pedidos/:id` que não existe.
 */
async function eventosDeTeste(db: D1Database): Promise<NotificacaoDerivada[]> {
  const { results } = await db
    .prepare(
      `SELECT id, criado_em FROM admin_diagnostico_eventos
       WHERE tipo = 'PEDIDO_TESTE'
       ORDER BY criado_em DESC, id DESC
       LIMIT ?`,
    )
    .bind(LIMITE_POR_TIPO)
    .all<{ id: number; criado_em: string }>();

  return (results || []).map((e) => ({
    chave: `teste:${e.id}:pedido`,
    tipo: "TESTE" as const,
    titulo: "Pedido de teste",
    descricao: "Simulação disparada manualmente — não é um pedido real.",
    em: e.criado_em,
    destino: null,
  }));
}

/** Todos os eventos derivados agora, sem estado de leitura. */
export async function derivarNotificacoes(db: D1Database): Promise<NotificacaoDerivada[]> {
  const grupos = await Promise.all([
    pedidosNovos(db),
    pagamentosConfirmados(db),
    estoqueNoLimite(db),
    operacoesInconclusivas(db),
    eventosDeTeste(db),
  ]);
  return grupos
    .flat()
    .sort((a, b) => Date.parse(b.em || "") - Date.parse(a.em || ""))
    .slice(0, LIMITE_TOTAL);
}

/**
 * Registra o disparo do diagnóstico "Pedido de produto de teste". Escreve
 * SOMENTE em `admin_diagnostico_eventos` — nenhum pedido, pagamento, item ou
 * produto é tocado. `usuarioId` é só rastreabilidade (quem disparou), não
 * afeta a derivação nem a visibilidade da notificação para outros operadores.
 */
export async function registrarEventoPedidoTeste(
  db: D1Database,
  usuarioId: number,
): Promise<number> {
  const result = await db
    .prepare(`INSERT INTO admin_diagnostico_eventos (tipo, usuario_id) VALUES ('PEDIDO_TESTE', ?)`)
    .bind(usuarioId)
    .run();
  return Number(result.meta.last_row_id);
}

export interface NotificacoesDoUsuario {
  notificacoes: Notificacao[];
  naoLidas: number;
}

/** Eventos derivados + estado de leitura do operador. */
export async function listarNotificacoes(
  db: D1Database,
  usuarioId: number,
): Promise<NotificacoesDoUsuario> {
  const derivadas = await derivarNotificacoes(db);
  if (derivadas.length === 0) return { notificacoes: [], naoLidas: 0 };

  const placeholders = derivadas.map(() => "?").join(",");
  const { results } = await db
    .prepare(
      `SELECT chave FROM notificacao_leituras
       WHERE usuario_id = ? AND chave IN (${placeholders})`,
    )
    .bind(usuarioId, ...derivadas.map((n) => n.chave))
    .all<{ chave: string }>();

  const lidas = new Set((results || []).map((r) => r.chave));
  const notificacoes = derivadas.map((n) => ({ ...n, lida: lidas.has(n.chave) }));
  return {
    notificacoes,
    naoLidas: notificacoes.reduce((total, n) => total + (n.lida ? 0 : 1), 0),
  };
}

/**
 * Marca chaves como lidas. `INSERT OR IGNORE` contra o UNIQUE
 * (usuario_id, chave): repetir é no-op, nunca erro nem linha duplicada.
 *
 * Só aceita chaves que são DERIVÁVEIS agora — o cliente não pode inventar
 * uma chave e poluir a tabela.
 */
export async function marcarComoLidas(
  db: D1Database,
  usuarioId: number,
  chaves: string[],
): Promise<number> {
  const derivadas = new Set((await derivarNotificacoes(db)).map((n) => n.chave));
  const validas = [...new Set(chaves)].filter((c) => derivadas.has(c));
  if (validas.length === 0) return 0;

  await db.batch(
    validas.map((chave) =>
      db
        .prepare(
          `INSERT OR IGNORE INTO notificacao_leituras (usuario_id, chave) VALUES (?, ?)`,
        )
        .bind(usuarioId, chave),
    ),
  );
  return validas.length;
}

/**
 * "Marcar todas como lidas" é resolvido no SERVIDOR, derivando de novo — não
 * depende de o cliente mandar a lista que está vendo. Duas abas com listas
 * diferentes chegam ao mesmo resultado.
 */
export async function marcarTodasComoLidas(
  db: D1Database,
  usuarioId: number,
): Promise<number> {
  const derivadas = await derivarNotificacoes(db);
  return marcarComoLidas(
    db,
    usuarioId,
    derivadas.map((n) => n.chave),
  );
}
