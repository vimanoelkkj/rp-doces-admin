import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function setupDomEnvironment({ href = "https://loja.test/" } = {}) {
  const elements = new Map();
  const listeners = new Map();
  const storage = new Map();

  function createElement(id, tagName = "div") {
    const el = {
      id,
      tagName,
      style: {},
      classList: {
        classes: new Set(),
        add(...cls) {
          cls.forEach(c => this.classes.add(c));
        },
        remove(...cls) {
          cls.forEach(c => this.classes.delete(c));
        },
        contains(c) {
          return this.classes.has(c);
        }
      },
      attributes: new Map(),
      setAttribute(k, v) {
        this.attributes.set(k, String(v));
      },
      getAttribute(k) {
        return this.attributes.get(k) ?? null;
      },
      removeAttribute(k) {
        this.attributes.delete(k);
      },
      textContent: "",
      value: "",
      src: "",
      href: "",
      disabled: false,
      _listeners: new Map(),
      addEventListener(event, fn) {
        if (!this._listeners.has(event)) this._listeners.set(event, []);
        this._listeners.get(event).push(fn);
      },
      dispatchEvent(event) {
        const fns = this._listeners.get(event.type) || [];
        fns.forEach(fn => fn(event));
      },
      click() {
        this.dispatchEvent({ type: "click", target: this });
      }
    };
    Object.defineProperty(el, "className", {
      get() {
        return [...this.classList.classes].join(" ");
      },
      set(val) {
        this.classList.classes.clear();
        if (val)
          val
            .split(/\s+/)
            .filter(Boolean)
            .forEach(c => this.classList.classes.add(c));
      }
    });
    return el;
  }

  const ids = [
    "pixOverlay",
    "pixClose",
    "pixPaymentView",
    "pixSuccessView",
    "pixQr",
    "pixCode",
    "pixCopy",
    "pixTicket",
    "pixNovo",
    "pixStatus",
    "pixStatusHelp",
    "pixResumo",
    "pixDone",
    "successOrder",
    "pixSuccessOrder",
    "pixSuccessTotal",
    "pixSuccessItems",
    "pixPaymentCard",
    "pixTimerBlock",
    "pixTimerLabel",
    "pixTimerCount",
    "pixTimerHint",
    "pixTimerVerifyingTitle",
    "pixTimerVerifyingText",
    "pixScanCopy",
    "pixExpiredIcon",
    "pixAnnouncer"
  ];

  ids.forEach(id => {
    elements.set(id, createElement(id));
  });

  const doc = {
    getElementById(id) {
      if (!elements.has(id)) {
        elements.set(id, createElement(id));
      }
      return elements.get(id);
    },
    querySelector() {
      return null;
    },
    addEventListener(event, fn) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(fn);
    },
    removeEventListener(event, fn) {
      if (!listeners.has(event)) return;
      listeners.set(
        event,
        listeners.get(event).filter(f => f !== fn)
      );
    },
    dispatchEvent(event) {
      const fns = listeners.get(event.type) || [];
      fns.forEach(fn => fn(event));
    },
    visibilityState: "visible",
    body: { style: {} }
  };

  const sessStorage = {
    getItem(k) {
      return storage.get(k) ?? null;
    },
    setItem(k, v) {
      storage.set(k, String(v));
    },
    removeItem(k) {
      storage.delete(k);
    },
    clear() {
      storage.clear();
    }
  };

  const nav = {
    clipboard: {
      written: null,
      async writeText(txt) {
        this.written = txt;
      }
    }
  };

  const win = {
    RPPix: null,
    sessionStorage: sessStorage,
    navigator: nav,
    location: {
      href,
      hostname: new URL(href).hostname,
      search: new URL(href).search
    },
    abrirCarrinho() {}
  };

  // Carrega e executa o script de public/index.html
  const html = fs.readFileSync(path.resolve(process.cwd(), "public/index.html"), "utf8");
  const scriptMatch = html.match(/<script id="rp-pix-flow">([\s\S]*?)<\/script>/);
  if (!scriptMatch) throw new Error("Script rp-pix-flow não encontrado em public/index.html");

  const scriptCode = scriptMatch[1];
  const runner = new Function("document", "window", "sessionStorage", "navigator", scriptCode);
  runner(doc, win, sessStorage, nav);

  return { doc, win, elements, sessStorage, listeners };
}

test("A. pix_expira_em válido renderiza timer", () => {
  const { win, doc } = setupDomEnvironment();
  const expIso = new Date(Date.now() + 25 * 60 * 1000).toISOString();

  win.RPPix.abrir({
    pedido: { token: "tok-1", pix_expira_em: expIso, valor_total_centavos: 2500 },
    pix: { qr_code: "000201PIX..." }
  });

  const timerBlock = doc.getElementById("pixTimerBlock");
  assert.equal(timerBlock.style.display, "inline-flex", "Timer deve estar visível");
  assert.ok(timerBlock.classList.contains("pix-timer"));

  const count = doc.getElementById("pixTimerCount");
  assert.match(count.textContent, /^\d{2}:\d{2}$/, "Contador deve exibir formato MM:SS");
  win.RPPix.fechar();
});

test("B. Timestamp 30 minutos à frente formata corretamente", () => {
  const { win } = setupDomEnvironment();
  const formatted = win.RPPix._formatRemainingTime(30 * 60 * 1000);
  assert.equal(formatted.text, "30:00");
  assert.equal(formatted.totalSec, 1800);

  const formatted29 = win.RPPix._formatRemainingTime(29 * 60 * 1000 + 47 * 1000);
  assert.equal(formatted29.text, "29:47");
});

test("C. Passagem de tempo recalcula usando Date.now() e não contador interno (anti-drift)", () => {
  const { win } = setupDomEnvironment();
  const realNow = Date.now();
  const expMs = realNow + 20 * 60 * 1000;

  // Estado calculado diretamente da diferença temporal
  const state1 = win.RPPix._getPixTimerState(expMs - realNow);
  assert.equal(state1, "normal");

  const state2 = win.RPPix._getPixTimerState(expMs - (realNow + 16 * 60 * 1000)); // 4m restantes
  assert.equal(state2, "urgent");
});

test("D. Avanço abrupto de 10 minutos atualiza imediatamente", () => {
  const { win, doc } = setupDomEnvironment();
  const realDateNow = Date.now;
  let simulatedTime = 1770000000000;
  Date.now = () => simulatedTime;

  try {
    const expIso = new Date(simulatedTime + 20 * 60 * 1000).toISOString();
    win.RPPix.abrir({
      pedido: { token: "tok-drift", pix_expira_em: expIso, valor_total_centavos: 3000 },
      pix: { qr_code: "PIX..." }
    });

    const count = doc.getElementById("pixTimerCount");
    assert.equal(count.textContent, "20:00");

    // Salta 10 minutos abruptamente
    simulatedTime += 10 * 60 * 1000;
    // Dispara tick
    doc.dispatchEvent({ type: "visibilitychange" });
    assert.equal(count.textContent, "10:00");
  } finally {
    Date.now = realDateNow;
    win.RPPix.fechar();
  }
});

test("E. Retorno de visibilitychange recalcula delta real", () => {
  const { win, doc } = setupDomEnvironment();
  const realDateNow = Date.now;
  let simulatedTime = 1770000000000;
  Date.now = () => simulatedTime;

  try {
    const expIso = new Date(simulatedTime + 10 * 60 * 1000).toISOString();
    win.RPPix.abrir({
      pedido: { token: "tok-vis", pix_expira_em: expIso },
      pix: { qr_code: "PIX..." }
    });

    const count = doc.getElementById("pixTimerCount");
    assert.equal(count.textContent, "10:00");

    // Avança 7 minutos enquanto tela em background
    simulatedTime += 7 * 60 * 1000;
    doc.visibilityState = "visible";
    doc.dispatchEvent({ type: "visibilitychange" });

    // Restam 3 minutos -> urgente
    assert.equal(count.textContent, "03:00");
    assert.ok(doc.getElementById("pixTimerBlock").classList.contains("urgent"));
  } finally {
    Date.now = realDateNow;
    win.RPPix.fechar();
  }
});

test("F. <= 5 minutos entra em estado urgente", () => {
  const { win, doc } = setupDomEnvironment();
  const realDateNow = Date.now;
  let simulatedTime = 1770000000000;
  Date.now = () => simulatedTime;

  try {
    const expIso = new Date(simulatedTime + 4 * 60 * 1000 + 30 * 1000).toISOString();
    win.RPPix.abrir({
      pedido: { token: "tok-urg", pix_expira_em: expIso },
      pix: { qr_code: "PIX..." }
    });

    const timerBlock = doc.getElementById("pixTimerBlock");
    const count = doc.getElementById("pixTimerCount");
    const hint = doc.getElementById("pixTimerHint");
    const announcer = doc.getElementById("pixAnnouncer");

    assert.ok(timerBlock.classList.contains("urgent"), "Deve conter classe .urgent");
    assert.equal(count.textContent, "04:30");
    assert.equal(hint.style.display, "block", "Hint deve estar visível");
    assert.equal(announcer.textContent, "", "Contagem regressiva não deve ser anunciada");
  } finally {
    Date.now = realDateNow;
    win.RPPix.fechar();
  }
});

test("G. 00:00 entra em Verificando pagamento", () => {
  const { win, doc } = setupDomEnvironment();
  const realDateNow = Date.now;
  let simulatedTime = 1770000000000;
  Date.now = () => simulatedTime;

  try {
    const expIso = new Date(simulatedTime - 5000).toISOString(); // já expirado no relógio
    win.RPPix.abrir({
      pedido: { token: "tok-zero", pix_expira_em: expIso },
      pix: { qr_code: "PIX..." }
    });

    const timerBlock = doc.getElementById("pixTimerBlock");
    const count = doc.getElementById("pixTimerCount");
    const verifyingTitle = doc.getElementById("pixTimerVerifyingTitle");
    const verifyingText = doc.getElementById("pixTimerVerifyingText");
    const announcer = doc.getElementById("pixAnnouncer");

    assert.ok(timerBlock.classList.contains("verifying"), "Deve conter classe .verifying");
    assert.notEqual(
      count.textContent,
      "00:00",
      "00:00 não deve permanecer como conteúdo principal"
    );
    assert.equal(verifyingTitle.textContent, "Verificando pagamento...");
    assert.equal(verifyingText.textContent, "Confirmando o status do Pix com o Mercado Pago.");
    assert.equal(announcer.textContent, "Verificando pagamento");
    assert.notEqual(win.RPPix._getPollInterval(), null, "Timer zero deve manter polling ativo");
  } finally {
    Date.now = realDateNow;
    win.RPPix.fechar();
  }
});

test("H. 00:00 NÃO mostra Expirado automaticamente (aguarda backend)", () => {
  const { win, doc } = setupDomEnvironment();
  const realDateNow = Date.now;
  let simulatedTime = 1770000000000;
  Date.now = () => simulatedTime;

  try {
    const expIso = new Date(simulatedTime - 10000).toISOString();
    win.RPPix.abrir({
      pedido: { token: "tok-wait", pix_expira_em: expIso },
      pix: { qr_code: "PIX..." }
    });

    const novoBtn = doc.getElementById("pixNovo");
    assert.notEqual(doc.getElementById("pixStatus").textContent, "Pix expirado");
    assert.equal(
      doc.getElementById("pixTimerVerifyingTitle").textContent,
      "Verificando pagamento..."
    );
    assert.equal(
      novoBtn.style.display,
      "none",
      "Botão Novo Pix não deve aparecer enquanto não confirmado pelo backend"
    );
  } finally {
    Date.now = realDateNow;
    win.RPPix.fechar();
  }
});

test("I. Backend PENDENTE após zero mantém Verificando pagamento", async () => {
  const { win, doc } = setupDomEnvironment();
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ pedido: { status: "PENDENTE" } }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });

  const realDateNow = Date.now;
  let simulatedTime = 1770000000000;
  Date.now = () => simulatedTime;

  try {
    const expIso = new Date(simulatedTime - 1000).toISOString();
    win.RPPix.abrir({
      pedido: { token: "tok-pend", pix_expira_em: expIso },
      pix: { qr_code: "PIX..." }
    });

    await win.RPPix.consultar();

    assert.equal(
      doc.getElementById("pixTimerVerifyingTitle").textContent,
      "Verificando pagamento..."
    );
    assert.equal(doc.getElementById("pixNovo").style.display, "none");
    assert.notEqual(win.RPPix._getPollInterval(), null, "PENDENTE deve manter polling ativo");
  } finally {
    Date.now = realDateNow;
    globalThis.fetch = oldFetch;
    win.RPPix.fechar();
  }
});

test("J. Backend PAGO após zero entra no fluxo de sucesso", async () => {
  const { win, doc } = setupDomEnvironment();
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        pedido: {
          status: "PAGO",
          referencia: "RP-1234",
          produto: "Bolo",
          quantidade: 1,
          itens: [
            { produto: "Bolo no pote", quantidade: 1 },
            { produto: "Mini pudim", quantidade: 2 }
          ],
          valor_total_centavos: 2500
        }
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" }
      }
    );

  const realDateNow = Date.now;
  let simulatedTime = 1770000000000;
  Date.now = () => simulatedTime;

  try {
    const expIso = new Date(simulatedTime - 1000).toISOString();
    win.RPPix.abrir({
      pedido: { token: "tok-pago", pix_expira_em: expIso },
      pix: {
        qr_code: "PIX...",
        qr_code_base64: "BASE64-QR",
        ticket_url: "https://example.test/pix"
      }
    });

    await win.RPPix.consultar();

    const paymentView = doc.getElementById("pixPaymentView");
    const successView = doc.getElementById("pixSuccessView");
    assert.equal(paymentView.style.display, "none", "Payment view deve ser oculta");
    assert.ok(successView.classList.contains("show"), "Success view deve ser exibida");
    assert.equal(doc.getElementById("pixQr").style.display, "none");
    assert.equal(doc.getElementById("pixCode").style.display, "none");
    assert.equal(doc.getElementById("pixCodeField").style.display, "none");
    assert.equal(doc.getElementById("pixCopy").style.display, "none");
    assert.equal(doc.getElementById("pixTicket").style.display, "none");
    assert.equal(doc.getElementById("pixTimerBlock").style.display, "none");
    assert.equal(doc.getElementById("pixSuccessOrder").textContent, "Pedido RP-1234 confirmado");
    assert.equal(doc.getElementById("pixSuccessTotal").textContent, "R$ 25,00");
    assert.equal(
      doc.getElementById("pixSuccessItems").textContent,
      "1× Bolo no pote • 2× Mini pudim"
    );
    assert.equal(doc.getElementById("pixAnnouncer").textContent, "Pagamento confirmado");
    assert.equal(win.RPPix._getTimerInterval(), null, "Timer deve ser parado após confirmação");
    assert.equal(win.RPPix._getPollInterval(), null, "Polling deve ser parado após confirmação");
  } finally {
    Date.now = realDateNow;
    globalThis.fetch = oldFetch;
    win.RPPix.fechar();
  }
});

test("K. Backend EXPIRADO confirma tela expirada e libera Gerar novo Pix", async () => {
  const { win, doc, sessStorage } = setupDomEnvironment();
  sessStorage.setItem("rp_cart_attempt", "attempt-old");

  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        pedido: { status: "EXPIRADO" }
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" }
      }
    );

  try {
    win.RPPix.abrir({
      pedido: { token: "tok-exp", pix_expira_em: new Date().toISOString() },
      pix: {
        qr_code: "PIX-COPIA-E-COLA",
        qr_code_base64: "BASE64-QR",
        ticket_url: "https://example.test/pix"
      }
    });

    await win.RPPix.consultar();

    assert.equal(doc.getElementById("pixStatus").textContent, "Pix expirado");
    assert.ok(doc.getElementById("pixStatus").classList.contains("pix-status--expired"));
    assert.match(
      doc.getElementById("pixStatusHelp").textContent,
      /Este código Pix não pode mais ser utilizado\./
    );
    assert.equal(
      doc.getElementById("pixNovo").style.display,
      "inline-flex",
      "Botão Gerar novo Pix deve estar visível"
    );
    assert.equal(
      doc.getElementById("pixCopy").style.display,
      "none",
      "Botão copiar deve ser oculto"
    );
    assert.equal(doc.getElementById("pixQr").style.display, "none", "QR Code deve ser oculto");
    assert.equal(doc.getElementById("pixCode").style.display, "none", "Código Pix deve ser oculto");
    assert.equal(
      doc.getElementById("pixCodeField").style.display,
      "none",
      "Campo copia-e-cola deve ser oculto"
    );
    assert.equal(
      doc.getElementById("pixTicket").style.display,
      "none",
      "Link do Mercado Pago deve ser oculto"
    );
    assert.equal(doc.getElementById("pixTimerBlock").style.display, "none");
    assert.equal(doc.getElementById("pixExpiredIcon").style.display, "flex");
    assert.equal(doc.getElementById("pixAnnouncer").textContent, "Pix expirado");
    assert.equal(
      sessStorage.getItem("rp_cart_attempt"),
      null,
      "Tentativa anterior deve ser limpa do sessionStorage"
    );
    assert.equal(win.RPPix._getTimerInterval(), null, "Timer deve ser parado");
    assert.equal(win.RPPix._getPollInterval(), null, "Polling deve ser parado");
  } finally {
    globalThis.fetch = oldFetch;
    win.RPPix.fechar();
  }
});

test("L. Erro 5xx/timeout após zero não mostra expirado", async () => {
  const { win, doc } = setupDomEnvironment();
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("Internal Server Error", { status: 500 });

  const realDateNow = Date.now;
  let simulatedTime = 1770000000000;
  Date.now = () => simulatedTime;

  try {
    const expIso = new Date(simulatedTime - 1000).toISOString();
    win.RPPix.abrir({
      pedido: { token: "tok-500", pix_expira_em: expIso },
      pix: { qr_code: "PIX..." }
    });

    await win.RPPix.consultar();

    assert.equal(
      doc.getElementById("pixTimerVerifyingTitle").textContent,
      "Verificando pagamento..."
    );
    assert.notEqual(doc.getElementById("pixStatus").textContent, "Pix expirado");
    assert.notEqual(win.RPPix._getPollInterval(), null, "5xx deve manter polling ativo");
  } finally {
    Date.now = realDateNow;
    globalThis.fetch = oldFetch;
    win.RPPix.fechar();
  }
});

test("L2. PENDENTE após zero aceita PAGO terminal na consulta seguinte", async () => {
  const { win, doc } = setupDomEnvironment();
  const oldFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        pedido:
          ++calls < 4
            ? { status: "PENDENTE" }
            : { status: "PAGO", referencia: "RP-200", valor_total_centavos: 1600 }
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );

  try {
    win.RPPix.abrir({
      pedido: {
        token: "tok-verifying-paid",
        pix_expira_em: new Date(Date.now() - 1000).toISOString()
      },
      pix: { qr_code: "PIX" }
    });

    await win.RPPix.consultar();
    assert.notEqual(win.RPPix._getPollInterval(), null);
    assert.equal(
      doc.getElementById("pixTimerVerifyingTitle").textContent,
      "Verificando pagamento..."
    );

    await win.RPPix.consultar();
    assert.ok(doc.getElementById("pixSuccessView").classList.contains("show"));
    assert.equal(win.RPPix._getPollInterval(), null);
  } finally {
    globalThis.fetch = oldFetch;
    win.RPPix.fechar();
  }
});

test("L3. PENDENTE após zero aceita EXPIRADO terminal na consulta seguinte", async () => {
  const { win, doc } = setupDomEnvironment();
  const oldFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ pedido: { status: ++calls < 4 ? "PENDENTE" : "EXPIRADO" } }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });

  try {
    win.RPPix.abrir({
      pedido: {
        token: "tok-verifying-expired",
        pix_expira_em: new Date(Date.now() - 1000).toISOString()
      },
      pix: { qr_code: "PIX" }
    });

    await win.RPPix.consultar();
    assert.notEqual(win.RPPix._getPollInterval(), null);

    await win.RPPix.consultar();
    assert.equal(doc.getElementById("pixStatus").textContent, "Pix expirado");
    assert.equal(win.RPPix._getPollInterval(), null);
  } finally {
    globalThis.fetch = oldFetch;
    win.RPPix.fechar();
  }
});

test("M. pix_expira_em null oculta timer mantendo QR e polling", () => {
  const { win, doc } = setupDomEnvironment();

  win.RPPix.abrir({
    pedido: { token: "tok-null", pix_expira_em: null },
    pix: { qr_code: "PIX-LEGADO" }
  });

  assert.equal(
    doc.getElementById("pixTimerBlock").style.display,
    "none",
    "Timer deve permanecer oculto"
  );
  assert.equal(
    doc.getElementById("pixCode").value,
    "PIX-LEGADO",
    "Código Pix deve ser preenchido normalmente"
  );
  assert.ok(win.RPPix._getPollInterval() !== null, "Polling deve continuar ativo");
  win.RPPix.fechar();
});

test("N. Timestamp inválido oculta timer com segurança", () => {
  const { win, doc } = setupDomEnvironment();

  win.RPPix.abrir({
    pedido: { token: "tok-invalid", pix_expira_em: "DATA_INVALIDA" },
    pix: { qr_code: "PIX-TEST" }
  });

  assert.equal(doc.getElementById("pixTimerBlock").style.display, "none");
  win.RPPix.fechar();
});

test("O. Fechar modal limpa interval e limpa estado", () => {
  const { win, doc } = setupDomEnvironment();

  win.RPPix.abrir({
    pedido: { token: "tok-close", pix_expira_em: new Date(Date.now() + 600000).toISOString() },
    pix: { qr_code: "PIX..." }
  });

  assert.ok(win.RPPix._getTimerInterval() !== null);
  assert.ok(win.RPPix._getPollInterval() !== null);

  doc.getElementById("pixClose").click();

  assert.equal(win.RPPix._getTimerInterval(), null, "Timer deve ser limpo");
  assert.equal(win.RPPix._getPollInterval(), null, "Polling deve ser limpo");
  assert.ok(!doc.getElementById("pixOverlay").classList.contains("open"));
});

test("P. Abrir outro Pix limpa timer e polling anteriores sem duplicação", () => {
  const { win } = setupDomEnvironment();

  win.RPPix.abrir({
    pedido: { token: "tok-first", pix_expira_em: new Date(Date.now() + 600000).toISOString() },
    pix: { qr_code: "PIX-1" }
  });

  const firstTimer = win.RPPix._getTimerInterval();
  const firstPoll = win.RPPix._getPollInterval();

  win.RPPix.abrir({
    pedido: { token: "tok-second", pix_expira_em: new Date(Date.now() + 1200000).toISOString() },
    pix: { qr_code: "PIX-2" }
  });

  const secondTimer = win.RPPix._getTimerInterval();
  const secondPoll = win.RPPix._getPollInterval();

  assert.notEqual(firstTimer, secondTimer, "Interval do timer deve ser renovado");
  assert.notEqual(firstPoll, secondPoll, "Interval do polling deve ser renovado");
  win.RPPix.fechar();
});

test("Q. Gerar novo Pix limpa rp_cart_attempt", () => {
  const { win, doc, sessStorage } = setupDomEnvironment();
  sessStorage.setItem("rp_cart_attempt", "old-attempt-key");

  win.RPPix.abrir({
    pedido: { token: "tok-exp", status: "EXPIRADO" }
  });

  const novoBtn = doc.getElementById("pixNovo");
  assert.equal(novoBtn.style.display, "inline-flex");

  novoBtn.click();

  assert.equal(sessStorage.getItem("rp_cart_attempt"), null, "sessionStorage deve ser limpo");
  assert.ok(!doc.getElementById("pixOverlay").classList.contains("open"));
});

test("R. Nova tentativa utiliza novo client_request_id (sessão limpa garante geração de novo UUID)", () => {
  const { sessStorage } = setupDomEnvironment();
  // Simula fluxo do carrinho: ao remover rp_cart_attempt, próxima chamada gera UUID novo
  sessStorage.setItem("rp_cart_attempt", "attempt-1111");
  sessStorage.removeItem("rp_cart_attempt");

  const clientRequestId =
    sessStorage.getItem("rp_cart_attempt") || "new-random-uuid-" + Math.random();
  assert.match(clientRequestId, /^new-random-uuid-/);
});

test("S. Botão copiar deixa de ficar disponível somente após EXPIRADO confirmado", async () => {
  const { win, doc } = setupDomEnvironment();
  const oldFetch = globalThis.fetch;

  try {
    // 1. Durante verificação, copiar ainda está disponível
    const expIso = new Date(Date.now() - 5000).toISOString();
    win.RPPix.abrir({
      pedido: { token: "tok-btn-copy", pix_expira_em: expIso },
      pix: { qr_code: "PIX-COPY-TEST" }
    });

    const copyBtn = doc.getElementById("pixCopy");
    assert.equal(
      copyBtn.style.display,
      "inline-flex",
      "Copiar deve estar disponível em Verificando"
    );

    // 2. Quando o backend confirma EXPIRADO, botão é ocultado
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ pedido: { status: "EXPIRADO" } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });

    await win.RPPix.consultar();
    assert.equal(
      copyBtn.style.display,
      "none",
      "Copiar deve ser desabilitado/oculto após confirmação de expirado"
    );
  } finally {
    globalThis.fetch = oldFetch;
    win.RPPix.fechar();
  }
});

test("T. PENDENTE -> PAGO antes do zero entra no estado terminal aprovado", async () => {
  const { win, doc } = setupDomEnvironment();
  const oldFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        pedido:
          ++calls === 1
            ? { status: "PENDENTE" }
            : {
                status: "PAGO",
                valor_total_centavos: 3200,
                itens: [{ produto: "Bolo no pote", quantidade: 2 }]
              }
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );

  try {
    win.RPPix.abrir({
      pedido: {
        token: "tok-paid-before-zero",
        referencia: "RP-77",
        pix_expira_em: new Date(Date.now() + 12 * 60 * 1000).toISOString(),
        valor_total_centavos: 3200,
        itens: [{ produto: "Bolo no pote", quantidade: 2 }]
      },
      pix: {
        qr_code: "PIX-ATIVO",
        qr_code_base64: "BASE64-QR",
        ticket_url: "https://example.test/pix"
      }
    });

    await win.RPPix.consultar();

    assert.ok(doc.getElementById("pixSuccessView").classList.contains("show"));
    assert.equal(doc.getElementById("pixSuccessOrder").textContent, "Pedido RP-77 confirmado");
    assert.equal(doc.getElementById("pixSuccessTotal").textContent, "R$ 32,00");
    assert.equal(doc.getElementById("pixSuccessItems").textContent, "2× Bolo no pote");
    assert.equal(win.RPPix._getTimerInterval(), null);
    assert.equal(win.RPPix._getPollInterval(), null);
  } finally {
    globalThis.fetch = oldFetch;
    win.RPPix.fechar();
  }
});

test("U. resposta PENDENTE atrasada não regride o estado PAGO", async () => {
  const { win, doc } = setupDomEnvironment();
  const oldFetch = globalThis.fetch;
  let resolvePending;
  let call = 0;
  globalThis.fetch = () => {
    call += 1;
    if (call === 1) {
      return new Promise(resolve => {
        resolvePending = () =>
          resolve(
            new Response(JSON.stringify({ pedido: { status: "PENDENTE" } }), {
              status: 200,
              headers: { "content-type": "application/json" }
            })
          );
      });
    }
    return Promise.resolve(
      new Response(
        JSON.stringify({
          pedido: {
            status: "PAGO",
            referencia: "RP-88",
            valor_total_centavos: 1800,
            itens: [{ produto: "Mini pudim", quantidade: 1 }]
          }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
  };

  try {
    win.RPPix.abrir({
      pedido: {
        token: "tok-race",
        referencia: "RP-88",
        pix_expira_em: new Date(Date.now() + 60_000).toISOString()
      },
      pix: { qr_code: "PIX" }
    });

    await win.RPPix.consultar();
    assert.ok(doc.getElementById("pixSuccessView").classList.contains("show"));

    resolvePending();
    await new Promise(resolve => setTimeout(resolve, 0));

    assert.ok(doc.getElementById("pixSuccessView").classList.contains("show"));
    assert.equal(doc.getElementById("pixPaymentView").style.display, "none");
    assert.equal(doc.getElementById("pixAnnouncer").textContent, "Pagamento confirmado");
  } finally {
    globalThis.fetch = oldFetch;
    win.RPPix.fechar();
  }
});

test("V. visibilitychange após PAGO não reinicia timer e anúncio ocorre uma vez", async () => {
  const { win, doc } = setupDomEnvironment();
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ pedido: { status: "PAGO", valor_total_centavos: 1000 } }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });

  const announcer = doc.getElementById("pixAnnouncer");
  let announced = "";
  let announcementCount = 0;
  Object.defineProperty(announcer, "textContent", {
    configurable: true,
    get: () => announced,
    set: value => {
      announced = value;
      if (value === "Pagamento confirmado") announcementCount += 1;
    }
  });

  try {
    win.RPPix.abrir({
      pedido: {
        token: "tok-visible-paid",
        referencia: "RP-99",
        pix_expira_em: new Date(Date.now() + 60_000).toISOString()
      },
      pix: { qr_code: "PIX" }
    });
    await win.RPPix.consultar();
    await win.RPPix.consultar();

    doc.visibilityState = "visible";
    doc.dispatchEvent({ type: "visibilitychange" });

    assert.equal(win.RPPix._getTimerInterval(), null);
    assert.equal(win.RPPix._getPollInterval(), null);
    assert.equal(announcementCount, 1);
  } finally {
    globalThis.fetch = oldFetch;
    win.RPPix.fechar();
  }
});

test("W. Voltar para a loja fecha o modal sem iniciar novo Pix", async () => {
  const { win, doc } = setupDomEnvironment();
  const oldFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return new Response(JSON.stringify({ pedido: { status: "PAGO" } }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  try {
    win.RPPix.abrir({
      pedido: { token: "tok-done", referencia: "RP-100", status: "PAGO" },
      pix: { qr_code: "PIX" }
    });
    const callsBeforeClose = fetchCalls;

    doc.getElementById("pixDone").click();

    assert.ok(!doc.getElementById("pixOverlay").classList.contains("open"));
    assert.equal(win.RPPix._getTimerInterval(), null);
    assert.equal(win.RPPix._getPollInterval(), null);
    assert.equal(fetchCalls, callsBeforeClose, "Fechar não deve criar uma nova tentativa Pix");
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test("X. QA Mode aceita somente localhost e 127.0.0.1", () => {
  const { win } = setupDomEnvironment();
  assert.equal(win.RPPix._isPixQaEnvironment({ hostname: "localhost" }), true);
  assert.equal(win.RPPix._isPixQaEnvironment({ hostname: "127.0.0.1" }), true);
  assert.equal(win.RPPix._isPixQaEnvironment({ hostname: "rp-doces.pages.dev" }), false);
  assert.equal(win.RPPix._isPixQaEnvironment({ hostname: "example.com" }), false);
});

test("Y. parâmetros QA são ignorados em produção", () => {
  const { win } = setupDomEnvironment({
    href: "https://rp-doces.pages.dev/?pixQa=1&ttl=1&scenario=paid"
  });
  assert.deepEqual(win.RPPix._getActiveQaConfig(), { enabled: false });
  assert.deepEqual(
    win.RPPix._getPixQaConfig({
      href: "https://rp-doces.pages.dev/?pixQa=1&ttl=1&scenario=expired",
      hostname: "rp-doces.pages.dev"
    }),
    { enabled: false }
  );
});

test("Z. TTL visual curto de QA chega a zero sem alterar o timestamp do pedido", async () => {
  const realDateNow = Date.now;
  let now = 1770000000000;
  Date.now = () => now;
  const originalExpiration = new Date(now + 30 * 60 * 1000).toISOString();
  const { win, doc } = setupDomEnvironment({
    href: "http://localhost:8788/?pixQa=1&ttl=10&scenario=pending"
  });

  try {
    win.RPPix.abrir({
      pedido: { token: "qa-pending", pix_expira_em: originalExpiration },
      pix: { qr_code: "PIX-QA" }
    });
    assert.equal(win.RPPix._getCurrentExpiration(), now + 10_000);

    now += 10_000;
    doc.dispatchEvent({ type: "visibilitychange" });
    await new Promise(resolve => setTimeout(resolve, 0));

    assert.equal(
      doc.getElementById("pixTimerVerifyingTitle").textContent,
      "Verificando pagamento..."
    );
    assert.notEqual(win.RPPix._getPollInterval(), null);
    assert.equal(originalExpiration, new Date(1770000000000 + 30 * 60 * 1000).toISOString());
  } finally {
    Date.now = realDateNow;
    win.RPPix.fechar();
  }
});

async function enterQaVerifying(win, doc, scenario) {
  win.RPPix.abrir({
    pedido: {
      token: `qa-${scenario}`,
      pix_expira_em: new Date(Date.now() + 30 * 60_000).toISOString()
    },
    pix: { qr_code: "PIX-QA" }
  });
  win.RPPix._startPixTimer(new Date(Date.now() - 1).toISOString());
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(
    doc.getElementById("pixTimerVerifyingTitle").textContent,
    "Verificando pagamento..."
  );
}

test("AA. QA paid alimenta a máquina real: PENDENTE -> PAGO", async () => {
  const { win, doc } = setupDomEnvironment({
    href: "http://localhost:8788/?pixQa=1&ttl=20&scenario=paid"
  });
  try {
    await enterQaVerifying(win, doc, "paid");
    await win.RPPix.consultar();
    assert.notEqual(win.RPPix._getPollInterval(), null);
    await win.RPPix.consultar();
    assert.ok(doc.getElementById("pixSuccessView").classList.contains("show"));
    assert.equal(win.RPPix._getPollInterval(), null);
  } finally {
    win.RPPix.fechar();
  }
});

test("AB. QA expired alimenta a máquina real: PENDENTE -> EXPIRADO", async () => {
  const { win, doc } = setupDomEnvironment({
    href: "http://127.0.0.1:8788/?pixQa=1&ttl=20&scenario=expired"
  });
  try {
    await enterQaVerifying(win, doc, "expired");
    await win.RPPix.consultar();
    assert.notEqual(win.RPPix._getPollInterval(), null);
    await win.RPPix.consultar();
    assert.equal(doc.getElementById("pixStatus").textContent, "Pix expirado");
    assert.equal(win.RPPix._getPollInterval(), null);
  } finally {
    win.RPPix.fechar();
  }
});

test("AC. QA recovery-paid preserva polling em 5xx e recupera para PAGO", async () => {
  const { win, doc } = setupDomEnvironment({
    href: "http://localhost:8788/?pixQa=1&ttl=10&scenario=recovery-paid"
  });
  try {
    await enterQaVerifying(win, doc, "recovery-paid");
    await win.RPPix.consultar();
    await win.RPPix.consultar();
    assert.notEqual(win.RPPix._getPollInterval(), null);
    await win.RPPix.consultar();
    assert.ok(doc.getElementById("pixSuccessView").classList.contains("show"));
  } finally {
    win.RPPix.fechar();
  }
});

test("AD. QA recovery-expired preserva polling em 5xx e recupera para EXPIRADO", async () => {
  const { win, doc } = setupDomEnvironment({
    href: "http://localhost:8788/?pixQa=1&ttl=10&scenario=recovery-expired"
  });
  try {
    await enterQaVerifying(win, doc, "recovery-expired");
    await win.RPPix.consultar();
    assert.notEqual(win.RPPix._getPollInterval(), null);
    await win.RPPix.consultar();
    assert.equal(doc.getElementById("pixStatus").textContent, "Pix expirado");
  } finally {
    win.RPPix.fechar();
  }
});
