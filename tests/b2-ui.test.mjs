import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

// DOM necessário: monta o componente real e executa effects, timers e Router.
// Não substitui useEffect/useNavigate por mocks nem testa uma cópia da lógica.
const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: "https://local.test" });
const channels = [];
const NativeMessageChannel = globalThis.MessageChannel;
globalThis.MessageChannel = class extends NativeMessageChannel {
  constructor() {
    super();
    channels.push(this);
  }
};
test.after(() => {
  dom.window.close();
  for (const channel of channels) {
    channel.port1.close();
    channel.port2.close();
  }
  globalThis.MessageChannel = NativeMessageChannel;
});
for (const name of ["window", "document", "navigator", "HTMLElement", "localStorage"]) {
  Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const bundle = await build({
  stdin: {
    resolveDir: process.cwd(),
    loader: "tsx",
    contents: `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {MemoryRouter,Routes,Route,useNavigate,useLocation} from 'react-router-dom';
    import {CartProvider,useCart} from './src/context/CartContext';
    import Waiting from './src/pages/AguardandoPagamento';
    import Failure from './src/pages/PagamentoNaoAprovado';
    export {act} from 'react';
    export let navigate;
    export let currentPath;
    export let currentState;
    export let cart;
    export const historico=[];
    function Probe(){
      const location=useLocation();
      navigate=useNavigate();
      currentPath=location.pathname;
      currentState=location.state;
      cart=useCart();
      // Uma entrada por navegação real. Identidade do objeto, não a key: com Math.random=0 toda key gerada pelo router é "".
      if(historico.at(-1)?.location!==location)historico.push({pathname:location.pathname,state:location.state,location});
      return null;
    }
    export function mount(container,state){
      historico.length=0;
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
  `
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"' },
  loader: { ".css": "empty", ".png": "dataurl" }
});
const ui = await import(
  `data:text/javascript;base64,${Buffer.from(`${bundle.outputFiles[0].text}\n//# sourceURL=b2-ui-bundle.mjs`).toString("base64")}`
);
const container = document.getElementById("root");
const flush = () =>
  ui.act(async () => {
    await new Promise(setImmediate);
  });
const initial = {
  items: [{ id: 1, name: "Bolo", price: 50, image: "", quantity: 2 }],
  cliente: { nome: "Teste", whatsapp: "11999999999" }
};
const LOADING_TOTAL_MIN_MS = 3000;
const RESULT_TRANSITION_MIN_MS = 1500;
const POLL_INTERVAL_MS = 4000;
function deferred() {
  let resolve;
  const promise = new Promise(r => {
    resolve = r;
  });
  return { promise, resolve };
}
async function mount(
  t,
  respond,
  checkoutResponse,
  onInitialRender,
  { state = initial, carrinho = [] } = {}
) {
  // Usa o relógio do contexto do teste; cada teste restaura mocks/timers.
  t.mock.timers.enable({
    apis: ["Date", "setTimeout", "setInterval"],
    now: Date.parse("2026-09-17T12:00:00Z")
  });
  // A UI sorteia a duração das duas etapas de loading e da transição
  // final. Fixa o menor valor para testar as fronteiras dos timers sem
  // depender de aleatoriedade.
  t.mock.method(Math, "random", () => 0);
  const advance = async ms => {
    await ui.act(async () => {
      t.mock.timers.tick(ms);
    });
    await flush();
  };
  const calls = [];
  const checkouts = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    if (url === "/api/checkout") {
      checkouts.push({ options });
      return (
        checkoutResponse?.() ??
        Response.json({
          pedidoId: 1,
          tokenPublico: "token",
          totalCentavos: 10000,
          qrCode: "qr",
          qrCodeBase64: "fake",
          expiresAt: new Date(Date.now() + 6000).toISOString()
        })
      );
    }
    if (url === "/api/config")
      return Response.json({
        config: {
          days: [],
          openTime: "09:00",
          closeTime: "20:00",
          localName: "R&P Doces",
          address: "",
          mapsLink: "",
          deliveryStatus: "unavailable",
          whatsapp: "11999999999",
          defaultMessage: ""
        }
      });
    calls.push({ url, options });
    return respond(calls.length);
  });
  // O CartProvider lê o carrinho salvo ao montar: cada teste começa com o carrinho combinado.
  localStorage.setItem("rp-doces:cart", JSON.stringify(carrinho));
  let root;
  await ui.act(async () => {
    root = ui.mount(container, state);
  });
  t.after(async () => {
    await ui.act(async () => root.unmount());
    container.innerHTML = "";
  });
  await flush();
  await onInitialRender?.({ checkouts });
  await advance(LOADING_TOTAL_MIN_MS);
  return { calls, advance, checkouts };
}

test("M: timer zero with approval in flight never navigates to failure; normal success animation remains", async t => {
  const pending = deferred();
  const { calls, advance } = await mount(
    t,
    () => pending.promise,
    undefined,
    () => {
      assert.match(container.textContent, /Preparando seu pedido/);
      assert.equal(
        container.querySelector(".preparando-cupcake svg").getAttribute("aria-hidden"),
        "true"
      );
    }
  );
  assert.equal(calls.length, 1);
  // M7: o polling é o gatilho explícito de recuperação (POST); o GET só lê.
  assert.equal(calls[0].url, "/api/pedido-status?token=token");
  assert.equal(calls[0].options?.method, "POST");
  await advance(8000);
  assert.equal(ui.currentPath, "/aguardando-pagamento");
  assert.match(container.textContent, /Prazo do QR encerrado/);
  assert.equal(container.querySelector(".pix-copy-btn").disabled, true);
  assert.equal(container.querySelector(".qr-code img"), null);
  assert.equal(calls.length, 1, "polls must not overlap a hanging request");
  pending.resolve(Response.json({ statusPagamento: "PAGO" }));
  await flush();
  assert.match(container.textContent, /Processando pagamento/);
  assert.equal(
    container.querySelector(".processando-donut svg").getAttribute("aria-hidden"),
    "true"
  );
  await advance(RESULT_TRANSITION_MIN_MS - 1);
  assert.equal(ui.currentPath, "/aguardando-pagamento");
  await advance(1);
  assert.equal(ui.currentPath, "/pedido-confirmado");
});

test("erro de checkout preserva mensagem e oculta somente o x redundante", async t => {
  await mount(
    t,
    () => Promise.resolve(Response.json({ statusPagamento: "PENDENTE" })),
    () => Response.json({ error: "Falha simulada ao gerar o Pix" }, { status: 500 })
  );
  assert.match(container.textContent, /Não foi possível gerar o Pix/);
  assert.match(container.textContent, /Falha simulada ao gerar o Pix/);
  assert.equal(
    container.querySelector(".status-icon--error svg").getAttribute("aria-hidden"),
    "true"
  );
  assert.equal(
    container.querySelector(".payment-btn-primary").textContent.trim(),
    "Voltar ao checkout"
  );
});

test("fallback offline mantem estado em texto e trata o desenho como redundante", async () => {
  const source = await readFile("public/admin-offline.html", "utf8");
  const offline = new JSDOM(source);
  assert.match(
    offline.window.document.querySelector("h1").textContent,
    /Sem conexão com a internet/
  );
  assert.equal(
    offline.window.document.querySelector(".offline-icon svg").getAttribute("aria-hidden"),
    "true"
  );
  assert.equal(
    offline.window.document.querySelector(".retry-btn").textContent.trim(),
    "Tentar novamente"
  );
  offline.window.close();
});

test("expired response remains inconclusive and polls again; 500 also cannot navigate to failure", async t => {
  const { calls, advance } = await mount(t, n =>
    Promise.resolve(
      n === 1
        ? new Response("offline", { status: 500 })
        : Response.json({ statusPagamento: n === 2 ? "EXPIRADO" : "PAGO" })
    )
  );
  await advance(4000);
  assert.equal(ui.currentPath, "/aguardando-pagamento");
  assert.match(container.textContent, /Ainda não confirmamos/);
  await advance(4000);
  assert.equal(calls.length, 3);
  await advance(RESULT_TRANSITION_MIN_MS);
  assert.equal(ui.currentPath, "/pedido-confirmado");
});

test("re-renders do CartProvider não recriam o intervalo do polling nem criam consultas imediatas; sair limpa o intervalo", async t => {
  const armados = [];
  const limpos = [];
  const { calls, advance } = await mount(
    t,
    () => Promise.resolve(Response.json({ statusPagamento: "PENDENTE" })),
    undefined,
    () => {
      // O polling ainda não existe (status "criando"): os espiões entram antes de ele ser armado.
      const setReal = globalThis.setInterval;
      const clearReal = globalThis.clearInterval;
      t.mock.method(globalThis, "setInterval", (handler, delay, ...args) => {
        const id = setReal(handler, delay, ...args);
        if (delay === POLL_INTERVAL_MS) armados.push(id);
        return id;
      });
      t.mock.method(globalThis, "clearInterval", id => {
        limpos.push(id);
        return clearReal(id);
      });
    }
  );
  const consultas = () => calls.filter(c => c.url.startsWith("/api/pedido-status")).length;
  const limposDoPolling = () => limpos.filter(id => armados.includes(id));
  assert.equal(consultas(), 1, "o Pix ativo faz a primeira consulta ao armar o polling");
  assert.equal(armados.length, 1, "o polling é armado uma vez");

  // clearCart é recriado a cada render do CartProvider: três renders reais do provider.
  for (const aberto of [true, false, true]) {
    await ui.act(async () => ui.cart.setCartOpen(aberto));
    await flush();
  }
  assert.equal(consultas(), 1, "re-render do provider não dispara consulta imediata");
  assert.equal(armados.length, 1, "re-render do provider não recria o intervalo");
  assert.deepEqual(limposDoPolling(), [], "o intervalo original segue ativo");

  await advance(POLL_INTERVAL_MS);
  assert.equal(consultas(), 2, "o ciclo regular de 4 s continua");
  await advance(POLL_INTERVAL_MS);
  assert.equal(consultas(), 3, "e segue com a mesma cadência");

  // Sair da página desmonta o componente: o intervalo precisa ser limpo, não só ignorado.
  await ui.act(async () => ui.navigate("/pedido/token"));
  assert.deepEqual(
    limposDoPolling(),
    [armados[0]],
    "desmontar limpa exatamente o intervalo do polling"
  );
  await advance(POLL_INTERVAL_MS * 3);
  assert.equal(consultas(), 3, "nenhuma consulta depois de sair");
});

test("checkout Pix: renderizações comuns em qualquer fase criam exatamente um POST /api/checkout", async t => {
  const { calls, advance, checkouts } = await mount(
    t,
    () => Promise.resolve(Response.json({ statusPagamento: "PENDENTE" })),
    undefined,
    // Fase de criação (telas de loading): o POST já saiu uma vez e renders comuns não o repetem.
    async ({ checkouts }) => {
      assert.equal(checkouts.length, 1, "o POST sai ao montar");
      assert.equal(checkouts[0].options.method, "POST");
      for (const aberto of [true, false, true]) {
        await ui.act(async () => ui.cart.setCartOpen(aberto));
        await flush();
      }
      assert.equal(checkouts.length, 1, "renders comuns durante a criação não repetem o POST");
    }
  );
  assert.equal(calls.length, 1, "Pix criado: o polling começou");
  const corpo = JSON.parse(checkouts[0].options.body);
  assert.deepEqual(corpo.items, [{ id: 1, quantity: 2 }]);
  assert.deepEqual(corpo.cliente, initial.cliente);
  assert.equal(typeof corpo.operationKey, "string");

  // Pagamento pronto: renders do provider, tiques do contador e um ciclo de polling.
  for (const aberto of [false, true, false]) {
    await ui.act(async () => ui.cart.setCartOpen(aberto));
    await flush();
  }
  await advance(POLL_INTERVAL_MS);
  assert.equal(checkouts.length, 1, "renders comuns com o Pix pronto não criam um segundo POST");
  assert.equal(checkouts[0].options.signal.aborted, false, "a operação segue viva na página");

  // Desmontar: o cleanup aborta a requisição e nada fica pendente.
  await ui.act(async () => ui.navigate("/pedido/token"));
  assert.equal(checkouts[0].options.signal.aborted, true, "desmontar aborta o AbortController");
  const consultasAoSair = calls.length;
  await advance(10_000);
  assert.equal(checkouts.length, 1, "nenhum POST depois de sair");
  assert.equal(calls.length, consultasAoSair, "nenhuma consulta pendente depois de sair");
  assert.equal(ui.currentPath, "/pedido/token");
});

test("checkout Pix usa o state da montagem: novo state na mesma rota não cria outro POST", async t => {
  const { advance, checkouts } = await mount(t, () =>
    Promise.resolve(Response.json({ statusPagamento: "PENDENTE" }))
  );
  assert.equal(checkouts.length, 1);
  const outro = {
    items: [{ id: 2, name: "Pudim", price: 20, image: "", quantity: 1 }],
    cliente: { nome: "Outra", whatsapp: "11988888888" }
  };
  await ui.act(async () => ui.navigate("/aguardando-pagamento", { state: outro }));
  await flush();
  await advance(POLL_INTERVAL_MS);
  assert.equal(checkouts.length, 1, "identidade nova de state não recria a operação financeira");
  assert.equal(checkouts[0].options.signal.aborted, false, "a operação original não é abortada");
  assert.equal(ui.currentPath, "/aguardando-pagamento");
});

test("late approved response after leaving waiting page cannot navigate or overwrite the new route", async t => {
  const pending = deferred();
  const { calls, advance } = await mount(t, () => pending.promise);
  await ui.act(async () => ui.navigate("/pedido/token"));
  assert.equal(calls[0].options.signal.aborted, true);
  pending.resolve(Response.json({ statusPagamento: "PAGO" }));
  await flush();
  await advance(10000);
  assert.equal(ui.currentPath, "/pedido/token");
  assert.equal(calls.length, 1);
});

test("timer zero during success transition cannot replace approval with failure", async t => {
  const pending = deferred();
  const { advance } = await mount(t, () => pending.promise);
  await advance(3000);
  pending.resolve(Response.json({ statusPagamento: "PAGO" }));
  await flush();
  await advance(RESULT_TRANSITION_MIN_MS);
  assert.equal(ui.currentPath, "/pedido-confirmado");
});

test("known rejection keeps the existing result transition without claiming no money was charged", async t => {
  const { advance } = await mount(t, () =>
    Promise.resolve(Response.json({ statusPagamento: "CANCELADO" }))
  );
  await advance(RESULT_TRANSITION_MIN_MS);
  assert.equal(ui.currentPath, "/pagamento-nao-aprovado");
  assert.match(container.textContent, /Valor do pedido/);
  assert.doesNotMatch(container.textContent, /Nenhum valor foi cobrado|Valor não cobrado/);
});

// Contador do Pix (effect de expiresAt). O prazo é relativo ao relógio simulado do mount() e medido
// a partir do instante em que a tela do QR aparece (fim das duas etapas de loading).
const pixCriado = campos => () =>
  Response.json({
    pedidoId: 1,
    tokenPublico: "token",
    totalCentavos: 10000,
    qrCode: "qr",
    qrCodeBase64: "fake",
    ...campos()
  });
const expiraApos = segundos => () => ({
  expiresAt: new Date(Date.now() + LOADING_TOTAL_MIN_MS + segundos * 1000).toISOString()
});
const semPolling = () => Promise.resolve(Response.json({ statusPagamento: "PENDENTE" }));
const tempoRestante = () => container.querySelector(".pix-timer strong")?.textContent ?? null;
// Espia só os intervalos de 1 s (o contador); o polling usa 4 s e não entra na conta.
function espiarContador(t) {
  const armados = [];
  const limpos = [];
  const setReal = globalThis.setInterval;
  const clearReal = globalThis.clearInterval;
  t.mock.method(globalThis, "setInterval", (handler, delay, ...args) => {
    const id = setReal(handler, delay, ...args);
    if (delay === 1000) armados.push(id);
    return id;
  });
  t.mock.method(globalThis, "clearInterval", id => {
    limpos.push(id);
    return clearReal(id);
  });
  return { armados, limpos: () => limpos.filter(id => armados.includes(id)) };
}

test("contador do Pix: mostra o prazo, avança com o relógio e encerra em zero", async t => {
  // 125,6 s: a fração acima de 0,5 distingue o arredondamento para baixo de round/ceil.
  const { advance } = await mount(t, semPolling, pixCriado(expiraApos(125.6)));
  assert.equal(tempoRestante(), "02:05");
  assert.match(container.querySelector(".pix-timer").textContent, /Expira em/);

  // O contador relê o relógio a cada 1 s: meio segundo depois nada muda.
  await advance(500);
  assert.equal(tempoRestante(), "02:05");
  await advance(500);
  assert.equal(tempoRestante(), "02:04");
  await advance(4000);
  assert.equal(tempoRestante(), "02:00");
  await advance(1000);
  assert.equal(tempoRestante(), "01:59", "minutos e segundos viram juntos");

  await advance(118_000);
  assert.equal(tempoRestante(), "00:01");
  assert.equal(container.querySelector(".pix-copy-btn").disabled, false, "dentro do prazo");
  assert.ok(container.querySelector(".qr-code img"), "QR visível dentro do prazo");
  assert.equal(container.querySelector(".pix-code-box").textContent, "qr");

  await advance(1000);
  assert.equal(tempoRestante(), "00:00");
  assert.match(container.querySelector(".pix-timer").textContent, /Prazo encerrado/);
  assert.match(container.textContent, /Prazo do QR encerrado/);
  assert.equal(container.querySelector(".pix-copy-btn").disabled, true);
  assert.ok(!container.querySelector(".qr-code img"), "sem QR depois do prazo");
  assert.equal(
    container.querySelector(".pix-code-box").textContent,
    "Código Pix com prazo encerrado"
  );

  await advance(5000);
  assert.equal(tempoRestante(), "00:00", "nunca fica negativo");
});

test("Pix já vencido ao chegar na tela: encerra o prazo de imediato, sem contagem negativa", async t => {
  await mount(t, semPolling, pixCriado(expiraApos(-10)));
  assert.equal(tempoRestante(), "00:00");
  assert.match(container.querySelector(".pix-timer").textContent, /Prazo encerrado/);
  assert.match(container.textContent, /Prazo do QR encerrado/);
  assert.equal(container.querySelector(".pix-copy-btn").disabled, true);
  assert.ok(!container.querySelector(".qr-code img"), "sem QR depois do prazo");
});

for (const [rotulo, campos] of [
  ["nulo", () => ({ expiresAt: null })],
  ["omitido", () => ({})],
  ["vazio", () => ({ expiresAt: "" })]
]) {
  test(`Pix sem expiresAt (${rotulo}): sem contador nem prazo encerrado, com QR e cópia ativos`, async t => {
    let espiao;
    const { advance } = await mount(t, semPolling, pixCriado(campos), () => {
      espiao = espiarContador(t);
    });
    assert.equal(espiao.armados.length, 0, "sem prazo não há intervalo de contagem");
    assert.ok(!container.querySelector(".pix-timer"), "sem bloco do contador");
    assert.doesNotMatch(container.textContent, /Expira em|Prazo|NaN/);
    assert.equal(container.querySelector(".pix-copy-btn").disabled, false);
    assert.ok(container.querySelector(".qr-code img"), "QR visível");
    assert.equal(container.querySelector(".pix-code-box").textContent, "qr");

    await advance(60_000);
    assert.ok(!container.querySelector(".pix-timer"), "segue sem contador com o passar do tempo");
    assert.equal(container.querySelector(".pix-copy-btn").disabled, false, "não expira sozinho");
    assert.equal(espiao.armados.length, 0);
  });
}

test("contador do Pix: renders do CartProvider não o recriam; sair da página limpa exatamente esse intervalo", async t => {
  let espiao;
  const { advance } = await mount(t, semPolling, pixCriado(expiraApos(600)), () => {
    espiao = espiarContador(t);
  });
  assert.equal(tempoRestante(), "10:00");
  assert.equal(espiao.armados.length, 1, "um único intervalo de 1 s é armado");

  // clearCart é recriado a cada render do CartProvider: três renders reais do provider.
  for (const aberto of [true, false, true]) {
    await ui.act(async () => ui.cart.setCartOpen(aberto));
    await flush();
  }
  assert.equal(espiao.armados.length, 1, "re-render do provider não recria o contador");
  assert.equal(espiao.limpos().length, 0, "o intervalo original segue ativo");

  await advance(2000);
  assert.equal(tempoRestante(), "09:58", "a contagem segue no mesmo intervalo");

  // Sair da página desmonta o componente: o intervalo precisa ser limpo, não só ignorado.
  await ui.act(async () => ui.navigate("/pedido/token"));
  const limpos = espiao.limpos();
  assert.ok(
    limpos.length === 1 && limpos[0] === espiao.armados[0],
    "desmontar limpa exatamente o intervalo do contador"
  );
});

// A tentativa original do checkout vale durante toda a montagem. `location.state` pode ser
// substituído ou virar null com a página montada (navegação para a mesma rota); a tela, o POST e o
// destino final seguem sendo os da tentativa que criou o Pix.
const estadoTrocado = {
  items: [{ id: 2, name: "Pudim", price: 20, image: "", quantity: 1 }],
  cliente: { nome: "Outra", whatsapp: "11988888888" }
};
const pixLongo = pixCriado(expiraApos(600));
const aprovaNaSegunda = n =>
  Promise.resolve(Response.json({ statusPagamento: n === 1 ? "PENDENTE" : "PAGO" }));
const recusaNaSegunda = n =>
  Promise.resolve(Response.json({ statusPagamento: n === 1 ? "PENDENTE" : "CANCELADO" }));
const itensNaTela = () =>
  [...container.querySelectorAll(".payment-order-item")].map(
    linha => linha.querySelector("span").textContent
  );
const navegacoesPara = caminho => ui.historico.filter(l => l.pathname === caminho).length;
// Com timers simulados, uma exceção no callback de um timer sobe por tick(): captura para asserir "sem TypeError".
async function avancarCapturando(advance, ms) {
  try {
    await advance(ms);
    return null;
  } catch (erro) {
    await flush();
    return erro;
  }
}

test("state substituído na mesma montagem: a confirmação usa os itens da tentativa original, sem novo POST", async t => {
  const { advance, checkouts } = await mount(t, aprovaNaSegunda, pixLongo, undefined, {
    carrinho: initial.items
  });
  assert.equal(checkouts.length, 1);

  await ui.act(async () => ui.navigate("/aguardando-pagamento", { state: estadoTrocado }));
  await flush();
  const telaAposTroca = itensNaTela();

  await advance(POLL_INTERVAL_MS);
  await advance(RESULT_TRANSITION_MIN_MS);
  assert.equal(ui.currentPath, "/pedido-confirmado");
  assert.deepEqual(ui.currentState, {
    pedidoId: 1,
    tokenPublico: "token",
    items: initial.items,
    totalCentavos: 10000
  });
  assert.equal(navegacoesPara("/pedido-confirmado"), 1, "uma única navegação para a confirmação");
  assert.equal(checkouts.length, 1, "nenhum POST adicional");
  assert.equal(ui.cart.cartItems.length, 0);
  assert.deepEqual(telaAposTroca, ["Bolo ×2"], "a tela segue na tentativa original");
});

test("state null com o Pix ativo: a tela mantém o QR e os itens da tentativa original", async t => {
  await mount(t, semPolling, pixLongo, undefined, { carrinho: initial.items });
  await ui.act(async () => ui.navigate("/aguardando-pagamento"));
  await flush();
  assert.ok(container.querySelector(".qr-code img"), "QR segue visível");
  assert.equal(container.querySelector(".pix-code-box").textContent, "qr");
  assert.deepEqual(itensNaTela(), ["Bolo ×2"]);
});

test("state null com o Pix ativo: a aprovação navega com os itens originais, sem lançar, e limpa o carrinho", async t => {
  const { advance, checkouts } = await mount(t, aprovaNaSegunda, pixLongo, undefined, {
    carrinho: initial.items
  });
  await ui.act(async () => ui.navigate("/aguardando-pagamento"));
  await flush();
  await advance(POLL_INTERVAL_MS);
  const erro = await avancarCapturando(advance, RESULT_TRANSITION_MIN_MS);
  assert.equal(erro, null, "a aprovação não pode lançar");
  assert.equal(ui.currentPath, "/pedido-confirmado");
  assert.deepEqual(ui.currentState.items, initial.items);
  assert.equal(navegacoesPara("/pedido-confirmado"), 1, "uma única navegação para a confirmação");
  assert.equal(ui.cart.cartItems.length, 0);
  assert.equal(checkouts.length, 1, "nenhum POST adicional");
});

for (const [rotulo, navegacao] of [
  ["substituído", { state: estadoTrocado }],
  ["null", undefined]
]) {
  test(`recusa com state ${rotulo}: o destino recebe os itens da tentativa original e o carrinho é preservado`, async t => {
    const { advance, checkouts } = await mount(t, recusaNaSegunda, pixLongo, undefined, {
      carrinho: initial.items
    });
    await ui.act(async () => ui.navigate("/aguardando-pagamento", navegacao));
    await flush();
    await advance(POLL_INTERVAL_MS);
    const erro = await avancarCapturando(advance, RESULT_TRANSITION_MIN_MS);
    assert.equal(erro, null, "a recusa não pode lançar");
    assert.equal(ui.currentPath, "/pagamento-nao-aprovado");
    assert.deepEqual(ui.currentState, { items: initial.items, totalCentavos: 10000 });
    assert.equal(navegacoesPara("/pagamento-nao-aprovado"), 1, "uma única navegação para a recusa");
    assert.equal(ui.cart.cartItems.length, 1, "recusa não limpa o carrinho");
    assert.equal(checkouts.length, 1, "nenhum POST adicional");
  });
}

test("sem state na chegada: volta ao cardápio sem criar checkout nem consultar o pagamento", async t => {
  const { calls, checkouts } = await mount(t, semPolling, undefined, undefined, { state: null });
  assert.deepEqual(
    ui.historico.map(l => l.pathname),
    ["/aguardando-pagamento", "/cardapio"]
  );
  assert.equal(ui.currentPath, "/cardapio");
  assert.equal(checkouts.length, 0);
  assert.equal(calls.length, 0);
});
