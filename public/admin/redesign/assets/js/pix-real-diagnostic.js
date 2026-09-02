const API = "/api/admin/health/pix-real";
const POLL_MS = 3000;

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
    throw error;
  }
  return payload;
}

function ensureStyles() {
  if (document.getElementById("rp-pix-real-diagnostic-style")) return;
  const style = document.createElement("style");
  style.id = "rp-pix-real-diagnostic-style";
  style.textContent = `
    .pix-real-card{grid-column:1/-1;border:1px solid #e8c9bd;background:linear-gradient(135deg,#fffaf7,#fff3ee);position:relative;overflow:hidden}
    .pix-real-card::after{content:"REAL";position:absolute;top:18px;right:18px;border:1px solid #d95f71;border-radius:999px;padding:4px 8px;color:#c94860;font-size:.62rem;font-weight:900;letter-spacing:.12em}
    .pix-real-card__body{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:18px;align-items:start}
    .pix-real-warning{margin:0 0 14px;color:#8d5d4d;font-size:.82rem;line-height:1.5;max-width:720px}
    .pix-real-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
    .pix-real-button{min-height:40px;border:0;border-radius:10px;padding:0 14px;background:#c94860;color:#fff;font:inherit;font-weight:800;cursor:pointer}
    .pix-real-button[disabled]{opacity:.55;cursor:wait}
    .pix-real-secondary{min-height:40px;border:1px solid #e2bdb2;border-radius:10px;padding:0 14px;background:#fff;color:#69443a;font:inherit;font-weight:800;cursor:pointer}
    .pix-real-status{display:flex;align-items:center;gap:8px;margin-top:14px;font-size:.78rem;font-weight:800;color:#76564c}
    .pix-real-status::before{content:"";width:8px;height:8px;border-radius:50%;background:#c89f35}
    .pix-real-status.is-paid{color:#2f8265}.pix-real-status.is-paid::before{background:#2f8265}
    .pix-real-status.is-error{color:#b4474b}.pix-real-status.is-error::before{background:#b4474b}
    .pix-real-result{display:grid;grid-template-columns:190px minmax(0,1fr);gap:18px;margin-top:18px;padding-top:18px;border-top:1px solid #ecd7cf}
    .pix-real-qr{width:190px;height:190px;display:grid;place-items:center;border:1px solid #ead3ca;border-radius:14px;background:#fff;overflow:hidden}
    .pix-real-qr img{width:100%;height:100%;object-fit:contain}
    .pix-real-copy{min-width:0}
    .pix-real-copy label{display:block;margin-bottom:6px;color:#8f6c61;font-size:.68rem;font-weight:900;text-transform:uppercase;letter-spacing:.08em}
    .pix-real-code{width:100%;min-height:82px;resize:vertical;border:1px solid #e5d1ca;border-radius:10px;padding:10px;background:#fff;color:#4d3028;font:600 .72rem/1.35 ui-monospace,SFMono-Regular,Consolas,monospace}
    .pix-real-meta{display:flex;gap:12px;flex-wrap:wrap;margin-top:10px;color:#98756a;font-size:.7rem}
    @media(max-width:760px){.pix-real-card__body{grid-template-columns:1fr}.pix-real-result{grid-template-columns:1fr}.pix-real-qr{width:min(220px,100%);height:auto;aspect-ratio:1}.pix-real-card::after{position:static;display:inline-block;margin-bottom:10px}}
  `;
  document.head.appendChild(style);
}

function cardMarkup() {
  return `
    <section class="store-card pix-real-card" data-pix-real-card>
      <div class="store-card__head"><span class="store-card__icon">⌁</span><div><h3>Diagnóstico Pix real</h3><p>Teste a integração bancária com uma cobrança real e isolada.</p></div></div>
      <div class="pix-real-card__body">
        <div>
          <p class="pix-real-warning"><strong>Movimenta dinheiro de verdade.</strong> O teste gera um Pix de <strong>R$ 1,00</strong> usando a credencial real do Mercado Pago. Ele não cria pedido, não baixa estoque e não entra no faturamento da loja.</p>
          <div class="pix-real-actions">
            <button type="button" class="pix-real-button" data-pix-real-generate>Gerar Pix real de R$ 1,00</button>
            <button type="button" class="pix-real-secondary" data-pix-real-check hidden>Consultar agora</button>
          </div>
          <div class="pix-real-status" data-pix-real-status>Aguardando geração</div>
        </div>
      </div>
      <div class="pix-real-result" data-pix-real-result hidden>
        <div class="pix-real-qr" data-pix-real-qr><span>QR indisponível</span></div>
        <div class="pix-real-copy">
          <label for="pixRealCode">Pix copia e cola</label>
          <textarea id="pixRealCode" class="pix-real-code" data-pix-real-code readonly></textarea>
          <div class="pix-real-actions" style="margin-top:8px">
            <button type="button" class="pix-real-secondary" data-pix-real-copy>Copiar código Pix</button>
            <a class="pix-real-secondary" data-pix-real-ticket target="_blank" rel="noopener noreferrer" hidden>Abrir no Mercado Pago</a>
          </div>
          <div class="pix-real-meta"><span data-pix-real-order></span><span>expira em cerca de 30 min</span></div>
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

  const apply = payload => {
    orderId = payload.order_id || orderId;
    if (orderId) orderLabel.textContent = `Order ${orderId}`;
    code.value = payload.qr_code || "";
    if (payload.qr_code_base64) {
      qr.innerHTML = `<img alt="QR Code do Pix real de teste" src="data:image/png;base64,${esc(payload.qr_code_base64)}">`;
    } else {
      qr.innerHTML = "<span>Use o copia e cola</span>";
    }
    if (payload.ticket_url) {
      ticket.href = payload.ticket_url;
      ticket.hidden = false;
    }
    result.hidden = false;
    check.hidden = false;

    if (payload.status === "PAGO") {
      setStatus("Pagamento confirmado pelo Mercado Pago", "paid");
      if (timer) clearInterval(timer);
      timer = null;
    } else if (["CANCELADO", "EXPIRADO", "FALHOU"].includes(payload.status)) {
      setStatus(`Teste encerrado: ${payload.status.toLowerCase()}`, "error");
      if (timer) clearInterval(timer);
      timer = null;
    } else {
      setStatus("Aguardando pagamento real…");
    }
  };

  const poll = async () => {
    if (!orderId) return;
    try {
      apply(await request(`${API}?order_id=${encodeURIComponent(orderId)}`));
    } catch (error) {
      setStatus(error?.message || "Falha ao consultar o pagamento.", "error");
    }
  };

  generate.addEventListener("click", async () => {
    if (generate.disabled) return;
    const confirmed = window.confirm("Este teste vai criar uma cobrança Pix REAL de R$ 1,00. O dinheiro será movimentado de verdade. Deseja continuar?");
    if (!confirmed) return;
    generate.disabled = true;
    setStatus("Gerando cobrança real…");
    try {
      const payload = await request(API, { method: "POST" });
      apply(payload);
      if (timer) clearInterval(timer);
      timer = setInterval(poll, POLL_MS);
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
      copy.textContent = "Copiado ✓";
      setTimeout(() => { copy.textContent = "Copiar código Pix"; }, 1600);
    } catch {
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
