const API = "/api/admin/health/pix-real";
const POLL_MS = 3000;
const DIAGNOSTIC_LABEL = "R$ 0,10";

function esc(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: { Accept: "application/json", ...(options.headers || {}) },
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
  if (document.getElementById("rp-pix-real-diagnostic-style")) return;

  const style = document.createElement("style");
  style.id = "rp-pix-real-diagnostic-style";
  style.textContent = `
    .pix-real-card {
      grid-column: 1 / -1;
      position: relative;
      overflow: hidden;
      border: 1px solid #e8c9bd;
      background: linear-gradient(180deg, #fffaf7 0%, #fff4ef 100%);
    }

    .pix-real-card::after {
      content: "REAL";
      position: absolute;
      top: 18px;
      right: 18px;
      border: 1px solid #d95f71;
      border-radius: 999px;
      padding: 4px 10px;
      color: #c94860;
      background: rgba(255, 255, 255, 0.92);
      font-size: 0.68rem;
      font-weight: 900;
      letter-spacing: 0.12em;
    }

    .pix-real-intro {
      display: grid;
      gap: 14px;
      margin-top: 12px;
    }

    .pix-real-alert {
      margin: 0;
      padding: 14px 16px;
      border: 1px solid #efd7cf;
      border-radius: 14px;
      background: rgba(255, 255, 255, 0.72);
      color: #7d564b;
      font-size: 0.92rem;
      line-height: 1.6;
    }

    .pix-real-toolbar,
    .pix-real-copy-actions {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      align-items: center;
    }

    .pix-real-button,
    .pix-real-link {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 44px;
      padding: 0 16px;
      border-radius: 12px;
      font: inherit;
      font-weight: 800;
      text-decoration: none;
      white-space: nowrap;
      transition: transform 0.12s ease, opacity 0.12s ease;
    }

    .pix-real-button:hover,
    .pix-real-link:hover {
      transform: translateY(-1px);
    }

    .pix-real-button:disabled {
      opacity: 0.6;
      cursor: wait;
      transform: none;
    }

    .pix-real-button--primary {
      border: 0;
      background: #c94860;
      color: #fff;
      cursor: pointer;
      box-shadow: 0 10px 24px rgba(201, 72, 96, 0.18);
    }

    .pix-real-button--secondary,
    .pix-real-link {
      border: 1px solid #dfbeb3;
      background: #fff;
      color: #6b473d;
      cursor: pointer;
    }

    .pix-real-status {
      display: flex;
      align-items: center;
      gap: 10px;
      min-height: 22px;
      color: #76564c;
      font-size: 0.86rem;
      font-weight: 800;
    }

    .pix-real-status::before {
      content: "";
      width: 10px;
      height: 10px;
      flex: 0 0 10px;
      border-radius: 999px;
      background: #c89f35;
      box-shadow: 0 0 0 4px rgba(200, 159, 53, 0.12);
    }

    .pix-real-status.is-paid {
      color: #2f8265;
    }

    .pix-real-status.is-paid::before {
      background: #2f8265;
      box-shadow: 0 0 0 4px rgba(47, 130, 101, 0.12);
    }

    .pix-real-status.is-error {
      color: #b4474b;
    }

    .pix-real-status.is-error::before {
      background: #b4474b;
      box-shadow: 0 0 0 4px rgba(180, 71, 75, 0.12);
    }

    .pix-real-result {
      display: grid;
      grid-template-columns: minmax(230px, 280px) minmax(0, 1fr);
      gap: 18px;
      margin-top: 20px;
      padding-top: 20px;
      border-top: 1px solid #ecd7cf;
      align-items: stretch;
    }

    .pix-real-panel {
      min-width: 0;
      padding: 16px;
      border: 1px solid #ead4cb;
      border-radius: 16px;
      background: rgba(255, 255, 255, 0.84);
    }

    .pix-real-panel__title {
      margin: 0 0 12px;
      color: #7b574d;
      font-size: 0.78rem;
      font-weight: 900;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }

    .pix-real-qr-box {
      width: 100%;
      aspect-ratio: 1;
      display: grid;
      place-items: center;
      box-sizing: border-box;
      overflow: hidden;
      padding: 16px;
      border: 1px dashed #dfc6bc;
      border-radius: 14px;
      background: #fff;
      color: #7e6258;
      text-align: center;
    }

    .pix-real-qr-box img {
      width: 100%;
      height: 100%;
      object-fit: contain;
      display: block;
    }

    .pix-real-code {
      width: 100%;
      min-height: 112px;
      box-sizing: border-box;
      resize: vertical;
      border: 1px solid #e2ccc3;
      border-radius: 12px;
      padding: 12px;
      background: #fff;
      color: #4d3028;
      font: 600 0.78rem/1.45 ui-monospace, SFMono-Regular, Consolas, monospace;
    }

    .pix-real-copy-actions {
      margin-top: 12px;
    }

    .pix-real-meta {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
      margin-top: 16px;
    }

    .pix-real-meta-item {
      min-width: 0;
      padding: 12px;
      border: 1px solid #efddd6;
      border-radius: 12px;
      background: #fff;
    }

    .pix-real-meta-item small {
      display: block;
      margin-bottom: 4px;
      color: #9a7569;
      font-size: 0.7rem;
      font-weight: 900;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }

    .pix-real-meta-item strong {
      display: block;
      color: #6a463b;
      font-size: 0.9rem;
      line-height: 1.4;
      word-break: break-word;
    }

    @media (max-width: 860px) {
      .pix-real-result {
        grid-template-columns: 1fr;
      }

      .pix-real-meta {
        grid-template-columns: 1fr;
      }
    }

    @media (max-width: 640px) {
      .pix-real-card::after {
        position: static;
        display: inline-block;
        margin: 0 0 10px;
      }

      .pix-real-toolbar,
      .pix-real-copy-actions {
        flex-direction: column;
        align-items: stretch;
      }

      .pix-real-button,
      .pix-real-link {
        width: 100%;
        box-sizing: border-box;
      }
    }
  `;

  document.head.appendChild(style);
}

function cardMarkup() {
  return `
    <section class="store-card pix-real-card" data-pix-real-card>
      <div class="store-card__head">
        <span class="store-card__icon">⌁</span>
        <div>
          <h3>Diagnóstico Pix real</h3>
          <p>Teste a integração bancária com uma cobrança real e isolada.</p>
        </div>
      </div>

      <div class="pix-real-intro">
        <p class="pix-real-alert">
          <strong>Movimenta dinheiro de verdade.</strong>
          Este teste gera um Pix de <strong>${DIAGNOSTIC_LABEL}</strong> usando a credencial real de diagnóstico do Mercado Pago.
          Ele não cria pedido, não baixa estoque e não entra no faturamento da loja.
        </p>

        <div class="pix-real-toolbar">
          <button type="button" class="pix-real-button pix-real-button--primary" data-pix-real-generate>
            Gerar Pix real de ${DIAGNOSTIC_LABEL}
          </button>
          <button type="button" class="pix-real-button pix-real-button--secondary" data-pix-real-check hidden>
            Consultar agora
          </button>
        </div>

        <div class="pix-real-status" data-pix-real-status>Aguardando geração do diagnóstico</div>
      </div>

      <div class="pix-real-result" data-pix-real-result hidden>
        <div class="pix-real-panel">
          <p class="pix-real-panel__title">QR Code</p>
          <div class="pix-real-qr-box" data-pix-real-qr>
            <span>QR indisponível.<br>Use o Pix copia e cola.</span>
          </div>
        </div>

        <div class="pix-real-panel">
          <p class="pix-real-panel__title">Pix copia e cola</p>
          <textarea class="pix-real-code" data-pix-real-code readonly placeholder="O código Pix aparecerá aqui"></textarea>

          <div class="pix-real-copy-actions">
            <button type="button" class="pix-real-button pix-real-button--secondary" data-pix-real-copy>
              Copiar código Pix
            </button>
            <a class="pix-real-link" data-pix-real-ticket target="_blank" rel="noopener noreferrer" hidden>
              Abrir no Mercado Pago
            </a>
          </div>

          <div class="pix-real-meta">
            <div class="pix-real-meta-item">
              <small>Order</small>
              <strong data-pix-real-order>—</strong>
            </div>
            <div class="pix-real-meta-item">
              <small>Expiração</small>
              <strong>cerca de 30 min</strong>
            </div>
          </div>
        </div>
      </div>
    </section>`;
}

function mount(storeView) {
  if (!storeView || storeView.querySelector("[data-pix-real-card]")) return;

  const grid = storeView.querySelector(".store-grid");
  if (!grid) return;

  ensureStyles();
  grid.insertAdjacentHTML("beforeend", cardMarkup());

  const card = grid.querySelector("[data-pix-real-card]");
  const generate = card.querySelector("[data-pix-real-generate]");
  const check = card.querySelector("[data-pix-real-check]");
  const result = card.querySelector("[data-pix-real-result]");
  const status = card.querySelector("[data-pix-real-status]");
  const qr = card.querySelector("[data-pix-real-qr]");
  const code = card.querySelector("[data-pix-real-code]");
  const copy = card.querySelector("[data-pix-real-copy]");
  const ticket = card.querySelector("[data-pix-real-ticket]");
  const orderLabel = card.querySelector("[data-pix-real-order]");

  let orderId = null;
  let timer = null;

  const setStatus = (text, kind = "") => {
    status.textContent = text;
    status.className = `pix-real-status${kind ? ` is-${kind}` : ""}`;
  };

  const stopPolling = () => {
    if (timer) clearInterval(timer);
    timer = null;
  };

  const poll = async () => {
    if (!orderId) return;
    try {
      apply(await request(`${API}?order_id=${encodeURIComponent(orderId)}`));
    } catch (error) {
      setStatus(error?.message || "Falha ao consultar o pagamento.", "error");
    }
  };

  const startPolling = () => {
    stopPolling();
    timer = setInterval(poll, POLL_MS);
  };

  const apply = payload => {
    orderId = payload.order_id || orderId;
    orderLabel.textContent = orderId || "—";
    code.value = payload.qr_code || "";
    result.hidden = false;
    check.hidden = false;

    if (payload.qr_code_base64) {
      qr.innerHTML = `<img alt="QR Code do Pix real de teste" src="data:image/png;base64,${esc(payload.qr_code_base64)}">`;
    } else {
      qr.innerHTML = "<span>QR indisponível.<br>Use o Pix copia e cola.</span>";
    }

    if (payload.ticket_url) {
      ticket.href = payload.ticket_url;
      ticket.hidden = false;
    } else {
      ticket.hidden = true;
      ticket.removeAttribute("href");
    }

    if (payload.status === "PAGO") {
      setStatus("Pagamento confirmado pelo Mercado Pago", "paid");
      stopPolling();
      return;
    }

    if (["CANCELADO", "EXPIRADO", "FALHOU"].includes(payload.status)) {
      setStatus(`Diagnóstico encerrado: ${payload.status.toLowerCase()}`, "error");
      stopPolling();
      return;
    }

    setStatus("Aguardando pagamento real…");
  };

  generate.addEventListener("click", async () => {
    if (generate.disabled) return;

    const confirmed = window.confirm(
      `Este teste vai criar uma cobrança Pix REAL de ${DIAGNOSTIC_LABEL}. O dinheiro será movimentado de verdade. Deseja continuar?`
    );

    if (!confirmed) return;

    generate.disabled = true;
    stopPolling();
    setStatus("Gerando cobrança real…");

    try {
      const payload = await request(API, { method: "POST" });
      apply(payload);
      startPolling();
    } catch (error) {
      setStatus(error?.message || "Não foi possível gerar o Pix real.", "error");
    } finally {
      generate.disabled = false;
    }
  });

  check.addEventListener("click", poll);

  copy.addEventListener("click", async () => {
    if (!code.value) return;

    try {
      await navigator.clipboard.writeText(code.value);
      const original = copy.textContent;
      copy.textContent = "Copiado ✓";
      setTimeout(() => {
        copy.textContent = original;
      }, 1500);
    } catch {
      code.focus();
      code.select();
      document.execCommand("copy");
    }
  });
}

function scan() {
  document.querySelectorAll(".store-view").forEach(mount);
}

const observer = new MutationObserver(scan);
observer.observe(document.documentElement, { childList: true, subtree: true });
scan();
