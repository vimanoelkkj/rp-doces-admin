/// <reference types="@cloudflare/workers-types" />

import { precoAtualCentavos, ProdutoRow } from "../lib/pricing";
import { liberarReservaPedido } from "../lib/stock";
import { postPagamentoMp } from "../lib/mpPost";
import {
  buscarOperacao,
  chaveMp,
  chavePagamento,
  chavePedido,
  conflitoOperacao,
  fingerprint,
  fontePedidoComPagamento,
  OPERACAO_HTTP_STATUS,
  OPERACAO_MENSAGENS,
  parseOperationKey,
  parseResultado,
  prepareClaimOperacao,
  registrarFase,
  type IdentidadeEsperada,
  type OperacaoRow,
} from "../lib/operacoes";
import { isValidWhatsappBr, normalizeWhatsappBr } from "../../shared/whatsapp";

interface Env {
  DB: D1Database;
  MP_ACCESS_TOKEN: string;
}

interface CheckoutItemInput {
  id: number;
  quantity: number;
}

interface CheckoutBody {
  items: CheckoutItemInput[];
  cliente: {
    nome: string;
    whatsapp: string;
  };
  recado?: string;
  /**
   * A1: identidade da FINALIZAÇÃO, criada pelo cliente antes do primeiro
   * POST. O carrinho não serve: ele representa a intenção de compra em
   * construção, não uma operação de checkout.
   */
  operationKey?: string;
}

interface CheckoutSucesso {
  pedidoId: number;
  tokenPublico: string;
  paymentId: number | string;
  status: string;
  qrCode: string | null;
  qrCodeBase64: string | null;
  ticketUrl: string | null;
  expiresAt: string | null;
  totalCentavos: number;
}

function jsonError(message: string, status: number, code?: string) {
  return Response.json(code ? { error: message, code } : { error: message }, { status });
}

const MAX_ITEMS_PER_PEDIDO = 50;
const MAX_TEXT_LENGTH = 200;
const PIX_EXPIRATION_MINUTES = 30;

const MENSAGEM_MP_RECUSOU = "Falha ao criar pagamento Pix";
const MENSAGEM_MP_INDISPONIVEL =
  "Não foi possível confirmar com o Mercado Pago se o Pix foi criado. Acompanhe o pedido em instantes.";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    return await handleCheckout(request, env);
  } catch (err) {
    console.error("Erro inesperado no checkout", err);
    return jsonError("Erro interno ao processar checkout", 500);
  }
};

async function handleCheckout(request: Request, env: Env): Promise<Response> {
  let body: CheckoutBody;
  try {
    body = await request.json();
  } catch {
    return jsonError("JSON inválido", 400);
  }

  if (!Array.isArray(body.items) || body.items.length === 0) {
    return jsonError("Carrinho vazio", 400);
  }
  if (body.items.length > MAX_ITEMS_PER_PEDIDO) {
    return jsonError("Carrinho com itens demais", 400);
  }
  if (
    !body.items.every(
      (i) => i && typeof i === "object" && Number.isInteger(i.id) && i.id > 0,
    )
  ) {
    return jsonError("Item de carrinho inválido", 400);
  }
  const nome = body.cliente?.nome?.trim();
  const whatsappInput = body.cliente?.whatsapp?.trim() ?? "";
  const whatsapp = normalizeWhatsappBr(whatsappInput);
  if (!nome || !whatsapp) {
    return jsonError("Dados do cliente incompletos", 400);
  }
  if (nome.length > MAX_TEXT_LENGTH || !isValidWhatsappBr(whatsappInput)) {
    return jsonError("Dados do cliente inválidos", 400);
  }

  const recado = (body.recado ?? "").slice(0, MAX_TEXT_LENGTH);

  const chave = parseOperationKey(body.operationKey);
  if (!chave.ok) {
    return jsonError(OPERACAO_MENSAGENS.OPERATION_KEY_INVALIDA, 400, chave.erro);
  }
  const operationKey = chave.key;
  const identidade: IdentidadeEsperada = {
    tipo: "CHECKOUT_SITE",
    escopo: "SITE",
    atorUsuarioId: null,
    // Itens (ids + quantidades, ordenados), cliente e recado. Preços são
    // resolvidos pelo servidor e congelados no pedido, não na identidade.
    fingerprint: fingerprint({
      itens: [...body.items]
        .map((i) => [i.id, i.quantity] as [number, number])
        .sort((a, b) => a[0] - b[0] || a[1] - b[1]),
      nome,
      whatsapp,
      recado,
    }),
  };

  // Lookup ANTES dos guards de catálogo/estoque: retry, abort, remontagem,
  // reload ou perda da resposta HTTP não podem virar um segundo pedido, um
  // segundo Pix ou uma segunda reserva — mesmo que o estoque já não permita
  // criar um pedido igual agora.
  const existente = await buscarOperacao(env.DB, operationKey);
  if (existente) {
    return await replayCheckout(env, existente, identidade);
  }

  const ids = [...new Set(body.items.map((i) => i.id))];
  const placeholders = ids.map(() => "?").join(",");
  const { results } = await env.DB.prepare(
    `SELECT id, nome, preco_centavos, preco_promocional_centavos,
            promocao_inicio, promocao_fim, disponivel, estoque, estoque_reservado
     FROM produtos WHERE id IN (${placeholders})`,
  )
    .bind(...ids)
    .all<ProdutoRow>();

  const produtosPorId = new Map(results.map((p) => [p.id, p]));

  let totalCentavos = 0;
  const itensParaPersistir: {
    produtoId: number;
    produtoNome: string;
    quantidade: number;
    valorUnitarioCentavos: number;
    valorTotalCentavos: number;
  }[] = [];

  for (const item of body.items) {
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 50) {
      return jsonError("Quantidade inválida", 400);
    }
    const produto = produtosPorId.get(item.id);
    if (!produto || !produto.disponivel) {
      return jsonError(`Produto ${item.id} indisponível`, 400);
    }
    const estoqueLivre = produto.estoque - produto.estoque_reservado;
    if (item.quantity > estoqueLivre) {
      return jsonError(`Estoque insuficiente para "${produto.nome}"`, 409);
    }
    const valorUnitarioCentavos = precoAtualCentavos(produto);
    const valorTotalItemCentavos = valorUnitarioCentavos * item.quantity;
    totalCentavos += valorTotalItemCentavos;
    itensParaPersistir.push({
      produtoId: produto.id,
      produtoNome: produto.nome,
      quantidade: item.quantity,
      valorUnitarioCentavos,
      valorTotalCentavos: valorTotalItemCentavos,
    });
  }

  // O Mercado Pago exige e-mail do pagador; o checkout do site só coleta
  // nome e WhatsApp, então geramos um e-mail sintético só pra satisfazer a API.
  const whatsappDigits = whatsapp.replace(/\D/g, "") || "cliente";
  const payerEmail = `${whatsappDigits}@checkout.rpdoces.com.br`;

  // A1: identidades técnicas DERIVADAS da operation key. Os UNIQUEs já
  // existentes de `pedidos.idempotency_key` e
  // `pedido_pagamentos.idempotency_key` passam a garantir atomicamente que a
  // mesma finalização produz UM pedido, UM conjunto de itens, UMA tentativa
  // Pix e UMA reserva. `token_publico` continua aleatório: é identificador
  // público de acompanhamento e nunca deve ser derivável de uma key.
  const idempotencyKeyPedido = chavePedido(operationKey);
  const idempotencyKey = chavePagamento(operationKey);
  const mpIdempotencyKey = chaveMp(operationKey);
  const tokenPublico = crypto.randomUUID();
  const expiresAt = new Date(
    Date.now() + PIX_EXPIRATION_MINUTES * 60 * 1000,
  ).toISOString();

  // Conteúdo original do POST, persistido ANTES do envio. É o que permite
  // que a mesma operação seja reconhecida/retomada com segurança depois de
  // um resultado ambíguo, preservando valor, expiração, referência externa e
  // dados do pagador — hoje parte disso só existia em memória.
  const mpRequest = {
    transaction_amount: totalCentavos / 100,
    description: "Pedido R&P Doces",
    payment_method_id: "pix",
    date_of_expiration: expiresAt,
    external_reference: tokenPublico,
    payer: { email: payerEmail, first_name: nome },
  };

  // Persiste pedido + itens + pagamento PENDENTE + alocações + reserva de
  // estoque num único batch (uma transação): o registro financeiro nasce
  // antes de chamar o Mercado Pago, sem janela entre "pagamento criado" e
  // "alocado aos itens" — cada statement resolve o id de que precisa por
  // subquery (token_publico / idempotency_key), sem depender de
  // last_row_id entre statements do mesmo batch.
  //
  // Passo 7: reserva_expira_em nasce com uma estimativa (+31min, 1min de
  // folga sobre o TTL de 30min do Pix) porque a reserva precisa proteger
  // a concorrência ANTES de sabermos a expiração real do MP — é
  // sincronizada com o valor real assim que o MP responde (mais abaixo).
  // A proteção real contra overselling não é nenhum WHERE aqui: é o CHECK
  // (estoque_reservado <= estoque) de `produtos`, avaliado por linha no
  // instante de cada UPDATE — se violar, o batch inteiro (pedido, itens,
  // pagamento, alocações, reserva) é revertido.
  let batchResults;
  try {
    batchResults = await env.DB.batch([
      // B5: `cliente_email`, `produto_nome`, `quantidade` e
      // `valor_unitario_centavos` são colunas do modelo legado
      // "um produto por pedido" que o `pedidos` histórico de produção exige
      // como NOT NULL sem DEFAULT. São preenchidas com valores NEUTROS por
      // compatibilidade estrutural e nada mais: a composição do pedido é
      // `pedido_itens` e o total é `valor_total_centavos`. `quantidade` é 1
      // porque o CHECK de produção exige `>= 1` — é o menor valor legal, não
      // uma afirmação sobre o pedido. `produto_id` fica NULL, como já
      // acontece nos pedidos multi-item históricos.
      env.DB.prepare(
        `INSERT INTO pedidos
           (token_publico, cliente_nome, cliente_whatsapp, observacao, valor_total_centavos,
            idempotency_key, reserva_status, reserva_expira_em, status_pedido,
            cliente_email, produto_nome, quantidade, valor_unitario_centavos)
         VALUES (?, ?, ?, ?, ?, ?, 'ATIVA', datetime('now', '+31 minutes'), 'NOVO', '', '', 1, 0)`,
      ).bind(
        tokenPublico,
        nome,
        whatsapp,
        recado,
        totalCentavos,
        idempotencyKeyPedido,
      ),
      ...itensParaPersistir.map((item) =>
        env.DB.prepare(
          `INSERT INTO pedido_itens
             (pedido_id, produto_id, produto_nome, quantidade, valor_unitario_centavos, valor_total_centavos)
           SELECT id, ?, ?, ?, ?, ? FROM pedidos WHERE token_publico = ?`,
        ).bind(
          item.produtoId,
          item.produtoNome,
          item.quantidade,
          item.valorUnitarioCentavos,
          item.valorTotalCentavos,
          tokenPublico,
        ),
      ),
      env.DB.prepare(
        `INSERT INTO pedido_pagamentos (pedido_id, metodo, origem, valor_centavos, status, idempotency_key)
         SELECT id, 'PIX_MP', 'SITE', ?, 'PENDENTE', ? FROM pedidos WHERE token_publico = ?`,
      ).bind(totalCentavos, idempotencyKey, tokenPublico),
      env.DB.prepare(
        `INSERT INTO pedido_pagamento_alocacoes (pagamento_id, pedido_item_id, valor_centavos)
         SELECT (SELECT id FROM pedido_pagamentos WHERE idempotency_key = ?), pi.id, pi.valor_total_centavos
         FROM pedido_itens pi
         JOIN pedidos p ON p.id = pi.pedido_id
         WHERE p.token_publico = ? AND pi.valor_total_centavos > 0`,
      ).bind(idempotencyKey, tokenPublico),
      ...itensParaPersistir.map((item) =>
        env.DB.prepare(
          `UPDATE produtos SET estoque_reservado = estoque_reservado + ?, atualizado_em = CURRENT_TIMESTAMP
           WHERE id = ?`,
        ).bind(item.quantidade, item.produtoId),
      ),
      // Claim A1 por último e condicionado ao pedido E ao pagamento
      // recém-criados: tudo numa única transação. `fase='LOCAL_CRIADA'`
      // porque o envio ao Mercado Pago ainda não aconteceu, e o conteúdo
      // original do POST já fica persistido junto com a key MP estável.
      prepareClaimOperacao(env.DB, {
        key: operationKey,
        ...identidade,
        fase: "LOCAL_CRIADA",
        mpIdempotencyKey,
        mpRequest: JSON.stringify(mpRequest),
        fonte: fontePedidoComPagamento(idempotencyKeyPedido, idempotencyKey),
      }),
    ]);
  } catch (err) {
    // Disputa da mesma operation key (UNIQUE de `pedidos.idempotency_key` ou
    // de `operation_key`): o batch do perdedor é revertido inteiro — nenhum
    // pedido, nenhuma reserva, nenhum POST — e ele recupera a vencedora.
    const vencedora = await buscarOperacao(env.DB, operationKey);
    if (vencedora) return await replayCheckout(env, vencedora, identidade);
    if (String((err as Error)?.message || "").includes("CHECK")) {
      return jsonError("Um ou mais produtos não possuem estoque suficiente disponível.", 409);
    }
    throw err;
  }

  const pedidoId = batchResults[0].meta.last_row_id;
  const pagamentoId = batchResults[1 + itensParaPersistir.length].meta.last_row_id;

  const envio = await postPagamentoMp(env.MP_ACCESS_TOKEN, mpIdempotencyKey, mpRequest);

  if (envio.resultado === "AMBIGUO") {
    // Timeout, erro de transporte, 5xx/408/429 ou corpo ilegível: NÃO é
    // possível provar se o Mercado Pago criou a cobrança. Antes do A1 um 5xx
    // caía no mesmo caminho da recusa definitiva (gravava FALHOU e liberava a
    // reserva) — uma rejeição inventada. Agora a operação permanece
    // INCONCLUSIVA e recuperável: ledger continua PENDENTE, reserva intacta
    // (B4), nenhuma key nova, nenhum pedido novo, nenhum sucesso nem
    // rejeição inventados. Um retry com a mesma key recupera esta operação.
    console.error("Resultado ambíguo ao criar pagamento Pix (checkout)", {
      pedidoId,
      motivo: envio.motivo,
      httpStatus: envio.httpStatus,
    });
    await registrarFase(env.DB, operationKey, {
      fase: "ENVIO_INCONCLUSIVO",
      erro: `AMBIGUO:${envio.motivo}`,
    });
    return jsonError(MENSAGEM_MP_INDISPONIVEL, 502, "MERCADO_PAGO_INDISPONIVEL");
  }

  if (envio.resultado === "RECUSA_DEFINITIVA") {
    // O Mercado Pago respondeu e recusou — rejeição COMPROVADA, não
    // ambígua. O ledger já pode registrar isso com mais fidelidade que
    // `pedidos`, que por compatibilidade do 4c-1 permanece PENDENTE.
    console.error("Mercado Pago checkout error", envio.httpStatus, envio.mensagem);

    await env.DB.prepare(
      `UPDATE pedido_pagamentos
       SET status = 'FALHOU', mp_status = ?, mp_status_detail = ?, atualizado_em = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'PENDENTE'`,
    )
      .bind(envio.mensagem, envio.detalhe, pagamentoId)
      .run();

    // Rejeição definitiva e conhecida (não ambígua): a reserva pode ser
    // liberada se os guards transacionais ainda permitirem: outro Pix ou
    // pagamento confirmado concorrente pode ter passado a reter a reserva.
    await liberarReservaPedido(env.DB, pedidoId);

    // Terminal: um retry da MESMA key devolve esta mesma recusa, sem novo
    // POST e sem nenhuma escrita adicional.
    await registrarFase(env.DB, operationKey, {
      fase: "RECUSADA",
      erro: `RECUSA_DEFINITIVA:${envio.httpStatus}`,
    });

    return jsonError(MENSAGEM_MP_RECUSOU, 502, "MERCADO_PAGO_RECUSOU");
  }

  const payment = envio.payment;
  const txData = payment.point_of_interaction?.transaction_data;

  // Passo 7: sincroniza reserva_expira_em com a expiração REAL do Pix
  // agora que o MP respondeu — deixa de usar a estimativa de +31min e
  // passa a usar o TTL real + 1min de folga, para não ter dois relógios
  // (o nosso e o do MP) fingindo que começaram juntos.
  const reservaExpiraEm = payment.date_of_expiration
    ? new Date(Date.parse(payment.date_of_expiration) + 60_000).toISOString()
    : null;

  const sucesso: CheckoutSucesso = {
    pedidoId,
    tokenPublico,
    paymentId: payment.id,
    status: payment.status,
    qrCode: txData?.qr_code ?? null,
    qrCodeBase64: txData?.qr_code_base64 ?? null,
    ticketUrl: txData?.ticket_url ?? null,
    expiresAt: payment.date_of_expiration,
    totalCentavos,
  };

  // Registra a identidade remota e o resultado ANTES de gravar os detalhes
  // locais. Se a gravação local a seguir falhar, o retry com a MESMA key
  // recupera este resultado em vez de criar outro pedido e outro POST: o
  // recurso remoto já existe e já tem nome.
  await registrarFase(env.DB, operationKey, {
    fase: "REMOTO_CONHECIDO",
    mpPaymentId: String(payment.id),
    resultado: JSON.stringify(sucesso),
  });

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE pedidos
       SET mp_payment_id = ?, mp_status = ?, mp_qr_code = ?, mp_qr_code_base64 = ?,
           mp_ticket_url = ?, pix_expira_em = ?,
           reserva_expira_em = COALESCE(?, reserva_expira_em),
           atualizado_em = CURRENT_TIMESTAMP
       WHERE id = ?`,
    ).bind(
      String(payment.id),
      payment.status,
      txData?.qr_code ?? null,
      txData?.qr_code_base64 ?? null,
      txData?.ticket_url ?? null,
      payment.date_of_expiration,
      reservaExpiraEm,
      pedidoId,
    ),
    env.DB.prepare(
      `UPDATE pedido_pagamentos
       SET mp_payment_id = ?, mp_status = ?, mp_qr_code = ?, mp_qr_code_base64 = ?,
           mp_ticket_url = ?, pix_expira_em = ?, atualizado_em = CURRENT_TIMESTAMP
       WHERE id = ?`,
    ).bind(
      String(payment.id),
      payment.status,
      txData?.qr_code ?? null,
      txData?.qr_code_base64 ?? null,
      txData?.ticket_url ?? null,
      payment.date_of_expiration,
      pagamentoId,
    ),
  ]);

  await registrarFase(env.DB, operationKey, { fase: "CONCLUIDA" });

  return Response.json(sucesso);
}

// A1 — replay do checkout. NUNCA cria outro pedido, outra tentativa, outra
// reserva, outra key nem faz outro POST. Nunca libera a reserva: um retry
// não é uma rejeição.
async function replayCheckout(
  env: Env,
  operacao: OperacaoRow,
  identidade: IdentidadeEsperada,
): Promise<Response> {
  const conflito = conflitoOperacao(operacao, identidade);
  if (conflito) {
    return jsonError(OPERACAO_MENSAGENS[conflito], OPERACAO_HTTP_STATUS[conflito], conflito);
  }

  // Recusa comprovada é terminal: repetir a mesma intenção devolve a mesma
  // recusa. Uma nova finalização explícita do cliente usa uma key nova.
  if (operacao.fase === "RECUSADA") {
    return jsonError(MENSAGEM_MP_RECUSOU, 502, "MERCADO_PAGO_RECUSOU");
  }

  const snapshot = parseResultado<CheckoutSucesso>(operacao);
  if (snapshot) return Response.json(snapshot);

  // Sem snapshot: reconstrói a partir das linhas persistidas.
  const linha = operacao.pedido_id
    ? await env.DB.prepare(
        `SELECT p.id AS pedido_id, p.token_publico, p.valor_total_centavos,
                pp.mp_payment_id, pp.mp_status, pp.mp_qr_code, pp.mp_qr_code_base64,
                pp.mp_ticket_url, pp.pix_expira_em
         FROM pedidos p
         JOIN pedido_pagamentos pp ON pp.id = ?
         WHERE p.id = ? LIMIT 1`,
      )
        .bind(operacao.pagamento_id, operacao.pedido_id)
        .first<{
          pedido_id: number;
          token_publico: string;
          valor_total_centavos: number;
          mp_payment_id: string | null;
          mp_status: string | null;
          mp_qr_code: string | null;
          mp_qr_code_base64: string | null;
          mp_ticket_url: string | null;
          pix_expira_em: string | null;
        }>()
    : null;

  if (!linha) {
    return jsonError(
      OPERACAO_MENSAGENS.OPERACAO_INCOMPLETA,
      OPERACAO_HTTP_STATUS.OPERACAO_INCOMPLETA,
      "OPERACAO_INCOMPLETA",
    );
  }

  if (linha.mp_payment_id) {
    return Response.json({
      pedidoId: linha.pedido_id,
      tokenPublico: linha.token_publico,
      paymentId: linha.mp_payment_id,
      status: linha.mp_status ?? "pending",
      qrCode: linha.mp_qr_code,
      qrCodeBase64: linha.mp_qr_code_base64,
      ticketUrl: linha.mp_ticket_url,
      expiresAt: linha.pix_expira_em,
      totalCentavos: linha.valor_total_centavos,
    } satisfies CheckoutSucesso);
  }

  // Operação local criada, mas sem recurso remoto conhecido: o envio não
  // chegou a produzir um resultado que possamos provar. Nada de reenvio
  // automático aqui (ver limite conservador do relatório A1) e nada de
  // inventar sucesso ou rejeição — a operação segue a MESMA, inconclusiva e
  // recuperável por webhook/reconciliação. O cliente recebe o token para
  // acompanhar o pedido que JÁ existe.
  return Response.json(
    {
      error: OPERACAO_MENSAGENS.OPERACAO_EM_PROCESSAMENTO,
      code: "OPERACAO_EM_PROCESSAMENTO",
      pedidoId: linha.pedido_id,
      tokenPublico: linha.token_publico,
    },
    { status: OPERACAO_HTTP_STATUS.OPERACAO_EM_PROCESSAMENTO },
  );
}
