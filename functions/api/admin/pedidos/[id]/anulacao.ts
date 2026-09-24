/// <reference types="@cloudflare/workers-types" />

import { requireUser, sameOrigin } from "../../../../lib/auth";
import {
  anularPedido,
  ANULACAO_ERROS,
  resolverPixNaoPagosParaAnulacao,
} from "../../../../lib/pedidoAnulacao";

interface Env {
  DB: D1Database;
  MP_ACCESS_TOKEN?: string;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  if (!sameOrigin(request)) return Response.json({ error: "Origem inválida" }, { status: 403 });
  const auth = await requireUser(env.DB, request);
  if ("error" in auth) return auth.error;
  const pedidoId = Number(params.id);
  if (!Number.isSafeInteger(pedidoId) || pedidoId <= 0) {
    return Response.json({ error: "Id inválido" }, { status: 400 });
  }
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("payload");
    body = parsed as Record<string, unknown>;
    if (Object.keys(body).some(key => !["devolverEstoque", "motivo"].includes(key))
      || typeof body.devolverEstoque !== "boolean"
      || (body.motivo !== undefined && (typeof body.motivo !== "string" || body.motivo.length > 300))) {
      throw new Error("payload");
    }
  } catch {
    return Response.json({ error: "Informe a opção de estoque e um motivo de até 300 caracteres." }, { status: 400 });
  }
  try {
    const resolucao = await resolverPixNaoPagosParaAnulacao(env.DB, {
      pedidoId,
      accessToken: env.MP_ACCESS_TOKEN,
      usuarioId: auth.user.id,
    });
    if (!resolucao.ok) {
      if (resolucao.erro === "PEDIDO_NAO_ENCONTRADO") {
        return Response.json({ error: "Pedido não encontrado" }, { status: 404 });
      }
      return Response.json({ error: resolucao.mensagem, code: resolucao.erro }, { status: 409 });
    }

    const result = await anularPedido(env.DB, {
      pedidoId, devolverEstoque: body.devolverEstoque as boolean,
      motivo: typeof body.motivo === "string" ? body.motivo.trim() : "",
      usuarioId: auth.user.id, usuarioNome: auth.user.nome,
    });
    return result ? Response.json({ ok: true, ...result })
      : Response.json({ error: "Pedido não encontrado" }, { status: 404 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = Object.keys(ANULACAO_ERROS).find(key => message.includes(key));
    if (code) return Response.json({ error: ANULACAO_ERROS[code], code }, { status: 409 });
    console.error("Falha ao anular pedido", { pedidoId }, error);
    return Response.json({ error: "Não foi possível excluir o pedido. Nenhuma alteração foi aplicada." }, { status: 500 });
  }
};
