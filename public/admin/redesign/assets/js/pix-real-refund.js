const API = "/api/admin/health/pix-real-refund";
const POLL_MS = 3000;

async function request(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {})
    },
    ...options
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.erro || payload?.detalhe || `HTTP ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

function ensureStyles() {
  if (document.getElementById("rp-pix-real-refund-style")) return;
  const style = document.createElement("style");
  style.id = "rp-pix-real-refund-style";
  style.textContent = `
    .pix-real-checks{grid-template-columns:repeat(3,minmax(0,1fr))}
    .pix-real-button--refund{border-color:#e5b8b8;background:#fff8f8;color:#a74047}
    .pix-real-button--refund:hover{background:#fff1f1;border-color:#d99b9f}
    .pix-real-button--duplicate{border-style:dashed}
    @container(max-width:760px){.pix-real-checks{grid-template-columns:1fr}}
    @media(max-width:900px){.pix-real-checks{grid-template-columns:1fr}}
  `;
  document.head.appendChild(style);
}

function orderIdFromCard(card) {
  const value = String(card.querySelector("[data-pix-real-order]")?.textContent || "").trim();
  return /^[A-Za-z0-9_-]{3,120}$/.test(value) ? value : null;
}

function paidInCard(card) {
  const provider = String(card.querySelector("[data-pix-provider-text]")?.textContent || "").toLowerCase();
  return provider.includes("pagamento confirmado");
}

function updateExpirationLabel(card) {
  card.querySelectorAll(".pix-real-meta-item").forEach(item => {
    const label = String(item.querySelector("small")?.textContent || "").trim().toLowerCase();
    if (label !== "expiração") return;
    const value = item.querySelector("strong");
    if (value) value.textContent = "cerca de 2 min";
  });
}

function normalizeWebhookCopy(card) {
  const webhookCheck = card.querySelector("[data-pix-webhook-check]");
  const webhookText = card.querySelector("[data-pix-webhook-text]");
  if (!webhookCheck || !webhookText || paidInCard(card)) return;

  const text = String(webhookText.textContent || "").trim();
  if (!text.includes("Webhook recebido pela R&P")) return;

  webhookText.textContent = "Webhook recebido · pagamento pendente";
  webhookCheck.className = "pix-real-check";
}

function mount(card) {
  if (!card || card.dataset.pixRefundMounted === "1") return;
  card.dataset.pixRefundMounted = "1";
  ensureStyles();
  updateExpirationLabel(card);

  const toolbar = card.querySelector(".pix-real-toolbar");
  const checks = card.querySelector("[data-pix-real-checks]");
  if (!toolbar || !checks) return;

  const refundButton = document.createElement("button");
  refundButton.type = "button";
  refundButton.className = "pix-real-button pix-real-button--secondary pix-real-button--refund";
  refundButton.textContent = "Reembolsar teste de R$ 0,10";
  refundButton.hidden = true;
  refundButton.dataset.pixRealRefund = "";
  toolbar.appendChild(refundButton);

  const duplicateButton = document.createElement("button");
  duplicateButton.type = "button";
  duplicateButton.className = "pix-real-button pix-real-button--secondary pix-real-button--duplicate";
  duplicateButton.textContent = "Testar reembolso duplicado";
  duplicateButton.hidden = true;
  duplicateButton.dataset.pixRealRefundDuplicate = "";
  toolbar.appendChild(duplicateButton);

  const refundCheck = document.createElement("div");
  refundCheck.className = "pix-real-check";
  refundCheck.innerHTML = `
    <span class="pix-real-check__dot"></span>
    <div><span>Reembolso</span><strong data-pix-refund-text>Aguardando pagamento</strong></div>
  `;
  checks.appendChild(refundCheck);
  const refundText = refundCheck.querySelector("[data-pix-refund-text]");

  let timer = null;
  let lastOrderId = null;
  let busy = false;
  let duplicateTested = false;

  const stopPolling = () => {
    if (timer) clearInterval(timer);
    timer = null;
  };

  const setRefundCheck = (text, kind = "") => {
    refundText.textContent = text;
    refundCheck.className = `pix-real-check${kind ? ` is-${kind}` : ""}`;
  };

  const resetForNewOrder = () => {
    duplicateTested = false;
    stopPolling();
    refundButton.hidden = true;
    refundButton.disabled = false;
    refundButton.textContent = "Reembolsar teste de R$ 0,10";
    duplicateButton.hidden = true;
    duplicateButton.disabled = false;
    duplicateButton.textContent = "Testar reembolso duplicado";
    setRefundCheck("Aguardando pagamento");
    normalizeWebhookCopy(card);
  };

  const payloadMatchesCurrentOrder = (payload, expectedOrderId) => {
    const payloadOrderId = String(payload?.order_id || "").trim();
    const currentOrderId = orderIdFromCard(card);
    return Boolean(
      expectedOrderId &&
      payloadOrderId &&
      payloadOrderId === expectedOrderId &&
      currentOrderId === expectedOrderId &&
      lastOrderId === expectedOrderId
    );
  };

  const applyRefund = payload => {
    const status = String(payload?.reembolso_status || "").toUpperCase();
    if (payload?.reembolsado || status === "REEMBOLSADO") {
      setRefundCheck(
        duplicateTested ? "Reembolso confirmado · duplicidade bloqueada ✓" : "Reembolso confirmado ✓",
        "ok"
      );
      refundButton.hidden = true;
      refundButton.disabled = false;
      duplicateButton.hidden = duplicateTested;
      duplicateButton.disabled = false;
      stopPolling();
      return;
    }

    duplicateButton.hidden = true;

    if (status === "PROCESSANDO") {
      setRefundCheck("Reembolso em processamento…");
      refundButton.hidden = false;
      refundButton.disabled = true;
      refundButton.textContent = "Reembolso em processamento…";
      if (!timer) timer = setInterval(sync, POLL_MS);
      return;
    }

    if (status === "FALHOU") {
      setRefundCheck("Falha no reembolso. Consulte novamente.", "error");
      refundButton.hidden = true;
      refundButton.disabled = false;
      stopPolling();
      return;
    }

    if (paidInCard(card)) {
      setRefundCheck("Disponível para teste");
      refundButton.hidden = false;
      refundButton.disabled = false;
      refundButton.textContent = "Reembolsar teste de R$ 0,10";
    } else {
      setRefundCheck("Aguardando pagamento");
      refundButton.hidden = true;
      refundButton.disabled = false;
    }
  };

  async function sync() {
    const orderId = orderIdFromCard(card);
    if (!orderId || busy) {
      if (!orderId) resetForNewOrder();
      return;
    }

    if (lastOrderId !== orderId) {
      lastOrderId = orderId;
      resetForNewOrder();
    }

    normalizeWebhookCopy(card);

    try {
      const payload = await request(`${API}?order_id=${encodeURIComponent(orderId)}`);
      if (!payloadMatchesCurrentOrder(payload, orderId)) return;
      applyRefund(payload);
    } catch (error) {
      if (orderIdFromCard(card) !== orderId || lastOrderId !== orderId) return;
      if (error?.status === 404) {
        refundButton.hidden = true;
        duplicateButton.hidden = true;
        setRefundCheck("Diagnóstico sem rastreio de reembolso", "error");
        return;
      }
      console.warn("R&P Admin: consulta do reembolso diagnóstico falhou.", error);
    }
  }

  refundButton.addEventListener("click", async () => {
    const orderId = orderIdFromCard(card);
    if (!orderId || busy) return;

    const confirmed = window.confirm(
      "Este teste vai devolver R$ 0,10 de verdade pelo Mercado Pago. Deseja solicitar o reembolso real?"
    );
    if (!confirmed) return;

    busy = true;
    refundButton.disabled = true;
    refundButton.textContent = "Solicitando reembolso…";
    setRefundCheck("Solicitando reembolso real…");

    try {
      const payload = await request(API, {
        method: "POST",
        body: JSON.stringify({ order_id: orderId })
      });
      if (!payloadMatchesCurrentOrder(payload, orderId)) return;
      applyRefund(payload);
      if (!payload?.reembolsado && String(payload?.reembolso_status || "").toUpperCase() === "PROCESSANDO") {
        if (!timer) timer = setInterval(sync, POLL_MS);
      }
    } catch (error) {
      if (orderIdFromCard(card) !== orderId || lastOrderId !== orderId) return;
      setRefundCheck(error?.message || "Falha ao solicitar reembolso.", "error");
      refundButton.hidden = false;
      refundButton.disabled = false;
      refundButton.textContent = "Consultar reembolso";
    } finally {
      busy = false;
    }
  });

  duplicateButton.addEventListener("click", async () => {
    const orderId = orderIdFromCard(card);
    if (!orderId || busy) return;

    const confirmed = window.confirm(
      "Este teste vai repetir a solicitação de reembolso para provar que o backend bloqueia duplicidade. Nenhum novo reembolso deve ser enviado ao Mercado Pago. Continuar?"
    );
    if (!confirmed) return;

    busy = true;
    duplicateButton.disabled = true;
    duplicateButton.textContent = "Testando proteção…";
    setRefundCheck("Testando proteção contra reembolso duplicado…");

    try {
      const payload = await request(API, {
        method: "POST",
        body: JSON.stringify({ order_id: orderId })
      });
      if (!payloadMatchesCurrentOrder(payload, orderId)) return;

      if (payload?.requisicao_duplicada === true && (payload?.ja_reembolsado === true || payload?.reembolsado === true)) {
        duplicateTested = true;
        applyRefund(payload);
        return;
      }

      setRefundCheck("Proteção não confirmada: resposta inesperada do backend.", "error");
      duplicateButton.hidden = false;
      duplicateButton.disabled = false;
      duplicateButton.textContent = "Testar reembolso duplicado";
    } catch (error) {
      if (orderIdFromCard(card) !== orderId || lastOrderId !== orderId) return;
      setRefundCheck(error?.message || "Falha ao testar proteção contra duplicidade.", "error");
      duplicateButton.hidden = false;
      duplicateButton.disabled = false;
      duplicateButton.textContent = "Testar reembolso duplicado";
    } finally {
      busy = false;
    }
  });

  const observer = new MutationObserver(() => {
    updateExpirationLabel(card);
    normalizeWebhookCopy(card);
    const orderId = orderIdFromCard(card);
    if (orderId !== lastOrderId || paidInCard(card)) sync();
  });
  observer.observe(card, { childList: true, subtree: true, characterData: true });

  sync();
}

function scan() {
  document.querySelectorAll("[data-pix-real-card]").forEach(mount);
}

const observer = new MutationObserver(scan);
observer.observe(document.documentElement, { childList: true, subtree: true });
scan();