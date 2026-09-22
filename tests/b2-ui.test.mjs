import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';

// DOM necessário: monta o componente real e executa effects, timers e Router.
// Não substitui useEffect/useNavigate por mocks nem testa uma cópia da lógica.
const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'https://local.test'});
const channels=[];
const NativeMessageChannel=globalThis.MessageChannel;
globalThis.MessageChannel=class extends NativeMessageChannel {
  constructor(){super();channels.push(this);}
};
test.after(()=>{
  dom.window.close();
  for(const channel of channels){channel.port1.close();channel.port2.close();}
  globalThis.MessageChannel=NativeMessageChannel;
});
for(const name of ['window','document','navigator','HTMLElement','localStorage']) {
  Object.defineProperty(globalThis,name,{configurable:true,value:dom.window[name]});
}
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const bundle=await build({
  stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {MemoryRouter,Routes,Route,useNavigate,useLocation} from 'react-router-dom';
    import {CartProvider} from './src/context/CartContext';
    import Waiting from './src/pages/AguardandoPagamento';
    import Failure from './src/pages/PagamentoNaoAprovado';
    export {act} from 'react';
    export let navigate;
    export let currentPath;
    function Probe(){navigate=useNavigate();currentPath=useLocation().pathname;return null;}
    export function mount(container,state){
      const root=createRoot(container);
      root.render(<MemoryRouter future={{v7_startTransition:true,v7_relativeSplatPath:true}} initialEntries={[{pathname:'/aguardando-pagamento',state}]}>
        <CartProvider><Probe/><Routes>
          <Route path="/aguardando-pagamento" element={<Waiting/>}/>
          <Route path="/pagamento-nao-aprovado" element={<Failure/>}/>
          <Route path="*" element={<p>Destino</p>}/>
        </Routes></CartProvider>
      </MemoryRouter>);
      return root;
    }
  `},bundle:true,write:false,format:'esm',platform:'browser',jsx:'automatic',
  define:{'process.env.NODE_ENV':'"development"'},loader:{'.css':'empty','.png':'dataurl'},
});
const ui=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text+'\n//# sourceURL=b2-ui-bundle.mjs').toString('base64')}`);
const container=document.getElementById('root');
const flush=()=>ui.act(async()=>{await new Promise(setImmediate);});
const initial={items:[{id:1,name:'Bolo',price:50,image:'',quantity:2}],cliente:{nome:'Teste',whatsapp:'11999999999'}};
const LOADING_TOTAL_MIN_MS=3000;
const RESULT_TRANSITION_MIN_MS=1500;
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}
async function mount(t,respond){
  // Usa o relógio do contexto do teste; cada teste restaura mocks/timers.
  t.mock.timers.enable({apis:['Date','setTimeout','setInterval'],now:Date.parse('2026-09-17T12:00:00Z')});
  // A UI sorteia a duração das duas etapas de loading e da transição
  // final. Fixa o menor valor para testar as fronteiras dos timers sem
  // depender de aleatoriedade.
  t.mock.method(Math,'random',()=>0);
  const advance=async ms=>{await ui.act(async()=>{t.mock.timers.tick(ms);});await flush();};
  const calls=[];
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    if(url==='/api/checkout') return Response.json({pedidoId:1,tokenPublico:'token',totalCentavos:10000,qrCode:'qr',qrCodeBase64:'fake',expiresAt:new Date(Date.now()+6000).toISOString()});
    if(url==='/api/config') return Response.json({config:{
      days:[],openTime:'09:00',closeTime:'20:00',localName:'R&P Doces',
      address:'',mapsLink:'',deliveryStatus:'unavailable',whatsapp:'11999999999',defaultMessage:''
    }});
    calls.push({url,options});
    return respond(calls.length);
  });
  let root;
  await ui.act(async()=>{root=ui.mount(container,initial);});
  t.after(async()=>{await ui.act(async()=>root.unmount());container.innerHTML='';});
  await flush(); await advance(LOADING_TOTAL_MIN_MS);
  return {calls,advance};
}

test('M: timer zero with approval in flight never navigates to failure; normal success animation remains',async t=>{
  const pending=deferred();
  const {calls,advance}=await mount(t,()=>pending.promise);
  assert.equal(calls.length,1);
  await advance(8000);
  assert.equal(ui.currentPath,'/aguardando-pagamento');
  assert.match(container.textContent,/Prazo do QR encerrado/);
  assert.equal(container.querySelector('.pix-copy-btn').disabled,true);
  assert.equal(container.querySelector('.qr-code img'),null);
  assert.equal(calls.length,1,'polls must not overlap a hanging request');
  pending.resolve(Response.json({statusPagamento:'PAGO'})); await flush();
  assert.match(container.textContent,/Processando pagamento/);
  await advance(RESULT_TRANSITION_MIN_MS-1);
  assert.equal(ui.currentPath,'/aguardando-pagamento');
  await advance(1);
  assert.equal(ui.currentPath,'/pedido-confirmado');
});

test('expired response remains inconclusive and polls again; 500 also cannot navigate to failure',async t=>{
  const {calls,advance}=await mount(t,n=>Promise.resolve(n===1?new Response('offline',{status:500}):Response.json({statusPagamento:n===2?'EXPIRADO':'PAGO'})));
  await advance(4000);
  assert.equal(ui.currentPath,'/aguardando-pagamento');
  assert.match(container.textContent,/Ainda não confirmamos/);
  await advance(4000);
  assert.equal(calls.length,3);
  await advance(RESULT_TRANSITION_MIN_MS);
  assert.equal(ui.currentPath,'/pedido-confirmado');
});

test('late approved response after leaving waiting page cannot navigate or overwrite the new route',async t=>{
  const pending=deferred();
  const {calls,advance}=await mount(t,()=>pending.promise);
  await ui.act(async()=>ui.navigate('/pedido/token'));
  assert.equal(calls[0].options.signal.aborted,true);
  pending.resolve(Response.json({statusPagamento:'PAGO'})); await flush();
  await advance(10000);
  assert.equal(ui.currentPath,'/pedido/token');
  assert.equal(calls.length,1);
});

test('timer zero during success transition cannot replace approval with failure',async t=>{
  const pending=deferred();
  const {advance}=await mount(t,()=>pending.promise);
  await advance(3000);
  pending.resolve(Response.json({statusPagamento:'PAGO'})); await flush();
  await advance(RESULT_TRANSITION_MIN_MS);
  assert.equal(ui.currentPath,'/pedido-confirmado');
});

test('known rejection keeps the existing result transition without claiming no money was charged',async t=>{
  const {advance}=await mount(t,()=>Promise.resolve(Response.json({statusPagamento:'CANCELADO'})));
  await advance(RESULT_TRANSITION_MIN_MS);
  assert.equal(ui.currentPath,'/pagamento-nao-aprovado');
  assert.match(container.textContent,/Valor do pedido/);
  assert.doesNotMatch(container.textContent,/Nenhum valor foi cobrado|Valor não cobrado/);
});
