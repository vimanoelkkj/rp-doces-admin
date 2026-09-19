/// <reference types="@cloudflare/workers-types" />

import { requireUser } from "../../../../../../lib/auth";
import { getItemExchangePreview, ItemExchangePreviewError } from "../../../../../../lib/itemExchange";

interface Env { DB: D1Database }
const fail=(message:string,status:number,code?:string,extra:object={})=>Response.json({error:message,...(code?{code}:{}),...extra},{status});

export const onRequestGet:PagesFunction<Env>=async({request,env,params})=>{
  const auth=await requireUser(env.DB,request);if("error" in auth)return auth.error;
  const url=new URL(request.url);const pedidoId=Number(params.id);const itemId=Number(params.itemId);
  const produtoDestinoId=Number(url.searchParams.get("produtoDestinoId"));
  const quantidadeDestino=Number(url.searchParams.get("quantidadeDestino"));
  const precoEsperadoCentavos=Number(url.searchParams.get("precoEsperadoCentavos"));
  const estoqueAcaoOrigem=url.searchParams.get("estoqueAcaoOrigem")??undefined;
  if(![pedidoId,itemId,produtoDestinoId,quantidadeDestino,precoEsperadoCentavos].every(Number.isSafeInteger))
    return fail("Parâmetros inválidos",400,"PARAMETROS_INVALIDOS");
  try{return Response.json(await getItemExchangePreview(env.DB,{pedidoId,itemId,produtoDestinoId,
    quantidadeDestino,precoEsperadoCentavos,estoqueAcaoOrigem}));}
  catch(error){if(error instanceof ItemExchangePreviewError)return fail(error.message,error.status,error.code,error.extra);
    console.error("Erro ao calcular preview de troca",error);return fail("Erro interno ao calcular a troca",500);}
};
