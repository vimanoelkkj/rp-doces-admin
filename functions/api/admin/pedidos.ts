/// <reference types="@cloudflare/workers-types" />

import { requireUser, sameOrigin } from "../../lib/auth";
import type { Env } from "../../lib/adminPedidos/types";
import { listPedidos } from "../../lib/adminPedidos/list";
import {
  normalizeManualItems,
  validarMetodoEStatus,
  type CriarPedidoManualBody,
  MAX_TEXT_LENGTH_MANUAL,
} from "../../lib/adminPedidos/manualValidation";
import { replayPedidoManual } from "../../lib/adminPedidos/manualReplay";
import { createManualPedido } from "../../lib/adminPedidos/manualCreation";
import {
  buscarOperacao,
  fingerprint,
  OPERACAO_MENSAGENS,
  parseOperationKey,
  type IdentidadeEsperada,
} from "../../lib/operacoes";
import { isValidWhatsappBr, normalizeWhatsappBr } from "../../../shared/whatsapp";

function jsonError(message: string, status: number, code?: string) {
  return Response.json(code ? { error: message, code } : { error: message }, { status });
}

export const onRequestGet: PagesFunction<Env> = (context) =>
  listPedidos(context);

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!sameOrigin(request)) return jsonError("Origem inválida", 403);
  const auth = await requireUser(env.DB, request);
  if ("error" in auth) return auth.error;

  let body: CriarPedidoManualBody;
  try {
    body = await request.json();
  } catch {
    return jsonError("JSON inválido", 400);
  }

  const itensResult = normalizeManualItems(body.itens);
  if (!itensResult.ok) return jsonError(itensResult.erro, 400);

  const metodoStatusResult = validarMetodoEStatus(body.metodoPagamento, body.statusPagamento);
  if (!metodoStatusResult.ok) return jsonError(metodoStatusResult.erro, 400);
  const { metodo: metodoPagamento, status: statusPagamento } = metodoStatusResult;

  const clienteNome = (body.clienteNome ?? "").trim().slice(0, MAX_TEXT_LENGTH_MANUAL);
  const clienteWhatsappInput = (body.clienteWhatsapp ?? "").trim();
  if (clienteWhatsappInput && !isValidWhatsappBr(clienteWhatsappInput)) {
    return jsonError("WhatsApp inválido", 400);
  }
  const clienteWhatsapp = normalizeWhatsappBr(clienteWhatsappInput);
  const observacao = (body.observacao ?? "").trim().slice(0, MAX_TEXT_LENGTH_MANUAL);

  // A1: identidade da intenção de criar esta venda, obrigatória. Um retry de
  // um pedido que nasce PAGO criaria outro pedido pago E outra baixa física
  // de estoque — nem o limite financeiro do pedido anterior protege contra
  // isso, porque o pedido é outro.
  const chave = parseOperationKey(body.operationKey);
  if (!chave.ok) {
    return jsonError(OPERACAO_MENSAGENS.OPERATION_KEY_INVALIDA, 400, chave.erro);
  }
  const operationKey = chave.key;
  const identidade: IdentidadeEsperada = {
    tipo: "PEDIDO_ADMIN",
    escopo: "ADMIN",
    atorUsuarioId: auth.user.id,
    // Itens normalizados e ordenados: a mesma intenção montada em outra
    // ordem na tela continua sendo a mesma intenção. Preços NÃO entram —
    // são resolvidos pelo servidor e congelados no pedido persistido.
    fingerprint: fingerprint({
      itens: [...itensResult.itens]
        .sort((a, b) => a.produtoId - b.produtoId)
        .map((i) => [i.produtoId, i.quantidade]),
      clienteNome,
      clienteWhatsapp,
      observacao,
      metodoPagamento,
      statusPagamento,
    }),
  };

  try {
    // Lookup ANTES dos guards de catálogo/estoque: um retry cujo resultado
    // HTTP se perdeu precisa recuperar o pedido original mesmo que o estoque
    // já não permita criar um pedido igual agora.
    const existente = await buscarOperacao(env.DB, operationKey);
    if (existente) {
      return await replayPedidoManual(env, existente, identidade, statusPagamento);
    }
  } catch (err) {
    console.error("Erro ao recuperar operação de criação de pedido (admin)", err);
    return jsonError("Erro interno ao criar pedido", 500);
  }

  return createManualPedido(env, {
    usuarioId: auth.user.id,
    itens: itensResult.itens,
    clienteNome,
    clienteWhatsapp,
    observacao,
    metodoPagamento,
    statusPagamento,
    operationKey,
    identidade,
  });
};
