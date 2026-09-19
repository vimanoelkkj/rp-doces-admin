/// <reference types="@cloudflare/workers-types" />

import { requireUser } from "../../../../../../lib/auth";
import { confirmExchangeRefund } from "../../../../../../lib/itemExchange";
import { OPERACAO_HTTP_STATUS, OPERACAO_MENSAGENS } from "../../../../../../lib/operacoes";
interface Env{DB:D1Database}
const messages:Record<string,string>={TROCA_NAO_ENCONTRADA:"Troca não encontrada.",TROCA_NAO_AGUARDANDO:"A troca não aguarda devolução.",
  PAGAMENTO_ALOCACAO_INVALIDA:"A perna financeira não pertence a esta troca.",PIX_MP_REFUND_REMOTO_PENDENTE:"O estorno Mercado Pago será tratado em uma fase futura.",
  VALOR_REFUND_DIVERGENTE:"Confirme exatamente o valor calculado pelo servidor.",...OPERACAO_MENSAGENS};
const fail=(message:string,status:number,code?:string)=>Response.json({error:message,...(code?{code}:{})},{status});
export const onRequestPost:PagesFunction<Env>=async({request,env,params})=>{
  const auth=await requireUser(env.DB,request);if("error" in auth)return auth.error;
  let body:Record<string,unknown>;try{body=await request.json();}catch{return fail("JSON inválido",400);}
  try{const result=await confirmExchangeRefund(env.DB,{pedidoId:Number(params.id),exchangeId:Number(params.trocaId),usuarioId:auth.user.id,
    operationKey:body.operationKey,pagamentoId:Number(body.pagamentoId),pagamentoAlocacaoId:Number(body.pagamentoAlocacaoId),
    valorCentavos:Number(body.valorCentavos),confirmacao:body.confirmacao===true});
    if(result.ok===false)return fail(messages[result.erro]??"Não foi possível registrar a devolução",OPERACAO_HTTP_STATUS[result.erro]??409,result.erro);
    return Response.json(result,{status:result.replay?200:201});
  }catch(error){console.error("Erro ao registrar devolução da troca",error);return fail("Erro interno ao registrar a devolução",500);}
};
