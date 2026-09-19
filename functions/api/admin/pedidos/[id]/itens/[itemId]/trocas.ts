/// <reference types="@cloudflare/workers-types" />

import { requireUser } from "../../../../../../lib/auth";
import { createItemExchange, getExchangeView, ItemExchangePreviewError } from "../../../../../../lib/itemExchange";
import { reconcileLiveTabParent } from "../../../../../../lib/liveTabRecovery";
import { OPERACAO_HTTP_STATUS, OPERACAO_MENSAGENS } from "../../../../../../lib/operacoes";
interface Env{DB:D1Database;MP_ACCESS_TOKEN?:string}
const messages:Record<string,string>={PREVIEW_OBSOLETO:"A comanda mudou. Revise a troca novamente.",PRECO_ALTERADO:"O preço do produto mudou.",
  ESTOQUE_INSUFICIENTE:"Estoque insuficiente para o produto de destino.",PIX_PENDENTE:"Há um Pix pendente nesta comanda.",...OPERACAO_MENSAGENS};
const fail=(message:string,status:number,code?:string,extra:object={})=>Response.json({error:message,...(code?{code}:{}),...extra},{status});
export const onRequestGet:PagesFunction<Env>=async({request,env,params})=>{
  const auth=await requireUser(env.DB,request);if("error" in auth)return auth.error;
  let troca=await getExchangeView(env.DB,Number(params.id),Number(params.itemId));
  if(troca){try{await reconcileLiveTabParent(env.DB,env.MP_ACCESS_TOKEN,{exchangeId:troca.id});
    troca=await getExchangeView(env.DB,Number(params.id),Number(params.itemId));}
    catch(error){console.error("Recuperacao oportunista de refund MP pendente",error);}}
  return troca?Response.json({troca}):fail("Troca não encontrada",404,"TROCA_NAO_ENCONTRADA");
};
export const onRequestPost:PagesFunction<Env>=async({request,env,params})=>{
  const auth=await requireUser(env.DB,request);if("error" in auth)return auth.error;
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
