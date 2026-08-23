import test from "node:test";
import assert from "node:assert/strict";
import { onRequestPost } from "../functions/api/checkout/pix.js";
import { fakeDb, responseJson } from "./helpers/fake-db.mjs";
const cliente={nome:"Maria",email:"maria@example.com",whatsapp:"(33) 99999-9999"};
function produto(id,o={}){return{id,nome:`Produto ${id}`,preco_centavos:1000,disponivel:1,ativo:1,estoque:10,promocao_ativa:0,preco_promocional_centavos:null,promocao_inicio:null,promocao_fim:null,...o}}
function db(produtos){
  return fakeDb(
    sql=>sql.includes("FROM produtos WHERE id IN")
      ? {all:s=>({results:produtos.filter(p=>s.args.includes(p.id))})}
      : {run:()=>({success:true,meta:{changes:1}})},
    async ss=>ss.map((_,i)=>({success:true,meta:i===0?{last_row_id:91,changes:1}:{changes:1}}))
  );
}
function req(body){return new Request("https://loja.test/api/checkout/pix",{method:"POST",headers:{"content-type":"application/json",Origin:"https://loja.test"},body:JSON.stringify(body)})}
test("multi-item usa preços do backend, promoção e um Pix",async t=>{const old=fetch;let calls=0,sent;globalThis.fetch=async(_u,i)=>{calls++;sent=JSON.parse(i.body);return new Response(JSON.stringify({id:"order-91",status:"created",transactions:{payments:[{id:"pay-1",payment_method:{qr_code:"PIX"}}]}}),{status:200})};t.after(()=>globalThis.fetch=old);const env={DB:db([produto(1),produto(2,{preco_centavos:2000,promocao_ativa:1,preco_promocional_centavos:1500,promocao_inicio:new Date(Date.now()-60000).toISOString()})]),MP_ACCESS_TOKEN:"teste"};const r=await onRequestPost({request:req({...cliente,total_centavos:1,itens:[{produto_id:1,quantidade:2,preco_centavos:1},{produto_id:2,quantidade:1,preco_centavos:1}]}),env});const body=await responseJson(r);assert.equal(r.status,201);assert.equal(body.pedido.valor_total_centavos,3500);assert.equal(body.pedido.itens[1].valor_unitario_centavos,1500);assert.equal(sent.total_amount,"35.00");assert.equal(sent.transactions.payments.length,1);assert.equal(calls,1)});
test("contrato legado de um item continua aceito",async t=>{const old=fetch;globalThis.fetch=async()=>new Response(JSON.stringify({id:"order-92",status:"created",transactions:{payments:[{}]}}),{status:200});t.after(()=>globalThis.fetch=old);const r=await onRequestPost({request:req({...cliente,produto_id:1,quantidade:1}),env:{DB:db([produto(1)]),MP_ACCESS_TOKEN:"teste"}});const b=await responseJson(r);assert.equal(r.status,201);assert.equal(b.pedido.itens.length,1);assert.equal(b.pedido.quantidade_total,1)});
test("itens repetidos respeitam limite total",async()=>{const r=await onRequestPost({request:req({...cliente,itens:[{produto_id:1,quantidade:30},{produto_id:1,quantidade:21}]}),env:{DB:db([produto(1)]),MP_ACCESS_TOKEN:"teste"}});assert.equal(r.status,400)});
test("estoque insuficiente impede criação do Pix",async t=>{const old=fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error()};t.after(()=>globalThis.fetch=old);const r=await onRequestPost({request:req({...cliente,itens:[{produto_id:1,quantidade:2}]}),env:{DB:db([produto(1,{estoque:1})]),MP_ACCESS_TOKEN:"teste"}});assert.equal(r.status,409);assert.equal(calls,0)});
