/// <reference types="@cloudflare/workers-types" />

import { recusarPedidoAnulado } from "../../../../../../lib/pedidoValido";
import { ESTORNO_ANULACAO_ATIVO_MENSAGEM } from "../../../../../../lib/pedidoAnulacao";

import { requireUser, sameOrigin } from "../../../../../../lib/auth";
import { createItemExchange, getExchangeView, ItemExchangePreviewError } from "../../../../../../lib/itemExchange";
import { OPERACAO_HTTP_STATUS, OPERACAO_MENSAGENS } from "../../../../../../lib/operacoes";
interface Env{DB:D1Database;MP_ACCESS_TOKEN?:string}
const messages:Record<string,string>={PREVIEW_OBSOLETO:"A comanda mudou. Revise a troca novamente.",PRECO_ALTERADO:"O preço do produto mudou.",
  ESTOQUE_INSUFICIENTE:"Estoque insuficiente para o produto de destino.",PIX_PENDENTE:"Há um Pix pendente nesta comanda.",
  ESTORNO_ANULACAO_ATIVO:ESTORNO_ANULACAO_ATIVO_MENSAGEM,...OPERACAO_MENSAGENS};
const fail=(message:string,status:number,code?:string,extra:object={})=>Response.json({error:message,...(code?{code}:{}),...extra},{status});
export const onRequestGet:PagesFunction<Env>=async({request,env,params})=>{
  const auth=await requireUser(env.DB,request);if("error" in auth)return auth.error;
  const pedidoId=Number(params.id),itemId=Number(params.itemId);
  if(!Number.isInteger(pedidoId)||pedidoId<=0||!Number.isInteger(itemId)||itemId<=0)
    return fail("Identificador inválido",400,"ID_INVALIDO");
  // Somente leitura: a retomada de refund/finalização pendente acontece por
  // POST /api/admin/pedidos/:id/reconciliar, disparado pela tela antes deste GET.
  const troca=await getExchangeView(env.DB,pedidoId,itemId);
  return troca?Response.json({troca}):fail("Troca não encontrada",404,"TROCA_NAO_ENCONTRADA");
};
export const onRequestPost:PagesFunction<Env>=async({request,env,params})=>{
  if(!sameOrigin(request))return fail("Origem inválida",403);
  const auth=await requireUser(env.DB,request);if("error" in auth)return auth.error;
  const anulado = await recusarPedidoAnulado(env.DB, Number(params.id));
  if (anulado) return anulado;

  const pedidoId=Number(params.id),itemId=Number(params.itemId);let body:Record<string,unknown>;
  try{body=await request.json();}catch{return fail("JSON inválido",400);}
  try{const result=await createItemExchange(env.DB,{pedidoId,itemId,usuarioId:auth.user.id,operationKey:body.operationKey,
    produtoDestinoId:Number(body.produtoDestinoId),quantidadeDestino:Number(body.quantidadeDestino),
    precoEsperadoCentavos:Number(body.precoEsperadoCentavos),estoqueAcaoOrigem:String(body.estoqueAcaoOrigem??""),
    previewFingerprint:String(body.previewFingerprint??""),motivo:typeof body.motivo==="string"?body.motivo:""});
    if(result.ok===false)return fail(messages[result.erro]??"Não foi possível executar a troca",OPERACAO_HTTP_STATUS[result.erro]??409,
      result.erro,{...(result.preview?{preview:result.preview}:{}),...(result.precoAtualCentavos!=null?{precoAtualCentavos:result.precoAtualCentavos}:{})});
    return Response.json(result,{status:result.replay?200:201});
  }catch(error){if(error instanceof ItemExchangePreviewError)return fail(error.message,error.status,error.code,error.extra);
    console.error("Erro ao executar troca",error);return fail("Erro interno ao executar a troca",500);}
};
