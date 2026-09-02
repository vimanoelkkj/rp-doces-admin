const ATTENTION_WAIT_MS = 4_000;
const HIGHLIGHT_MS = 2_600;

function normalize(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function waitFor(selector, { timeout = ATTENTION_WAIT_MS } = {}) {
  const existing = document.querySelector(selector);
  if (existing) return Promise.resolve(existing);

  return new Promise(resolve => {
    const observer = new MutationObserver(() => {
      const found = document.querySelector(selector);
      if (!found) return;
      observer.disconnect();
      window.clearTimeout(timer);
      resolve(found);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    const timer = window.setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, timeout);
  });
}

function highlight(target) {
  if (!(target instanceof Element)) return;
  target.classList.add("rp-attention-target");
  target.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
  window.setTimeout(() => target.classList.remove("rp-attention-target"), HIGHLIGHT_MS);
}

async function goToPage(page) {
  const nav = document.querySelector(`[data-admin-nav="${page}"]`);
  if (!(nav instanceof HTMLElement)) return false;
  nav.click();
  const rootSelector = page === "pedidos" ? ".orders-view" : ".products-view";
  return Boolean(await waitFor(rootSelector));
}

async function focusReceivables() {
  if (!(await goToPage("pedidos"))) return;
  const filter = await waitFor('[data-queue-filter="receber"]');
  filter?.click();
  const row = await waitFor('.orders-card [data-queue-financial].is-fin-pending, .orders-card [data-queue-financial].is-fin-partial');
  highlight(row?.closest(".orders-card") || document.querySelector("[data-orders-list]"));
}

async function focusPreparation() {
  if (!(await goToPage("pedidos"))) return;
  const filter = await waitFor('[data-queue-filter="entregar"]');
  filter?.click();

  const list = await waitFor("[data-orders-list]");
  const target = [...(list?.querySelectorAll(".orders-card") || [])].find(card =>
    normalize(card.querySelector("[data-queue-delivery]")?.textContent).includes("a preparar")
  );
  highlight(target || list);
}

async function focusSoldOut() {
  if (!(await goToPage("produtos"))) return;
  const filter = await waitFor('[data-products-filter="esgotados"]');
  filter?.click();
  const stock = await waitFor(".products-card .products-stock.is-danger");
  highlight(stock?.closest(".products-card") || document.querySelector("[data-products-grid]"));
}

async function focusLowStock() {
  if (!(await goToPage("produtos"))) return;
  document.querySelector('[data-products-filter="todos"]')?.click();
  const stock = await waitFor(".products-card .products-stock.is-warning");
  highlight(stock?.closest(".products-card") || document.querySelector("[data-products-grid]"));
}

function actionFor(text) {
  const value = normalize(text);
  if (value.includes("saldo pendente")) return focusReceivables;
  if (value.includes("aguardando preparacao")) return focusPreparation;
  if (value.includes("sem estoque")) return focusSoldOut;
  if (value.includes("estoque baixo")) return focusLowStock;
  return null;
}

function enhanceAttentionItem(item) {
  if (!(item instanceof HTMLElement) || item.dataset.attentionLink === "1") return;
  const action = actionFor(item.textContent);
  if (!action) return;

  item.dataset.attentionLink = "1";
  const current = item.innerHTML;
  item.innerHTML = `<button type="button" class="dashboard-attention__link">${current}<span class="dashboard-attention__arrow" aria-hidden="true">›</span></button>`;
  item.querySelector(".dashboard-attention__link")?.addEventListener("click", () => void action());
}

function enhance(root = document) {
  if (root.matches?.(".dashboard-attention li")) enhanceAttentionItem(root);
  root.querySelectorAll?.(".dashboard-attention li").forEach(enhanceAttentionItem);
}

const style = document.createElement("style");
style.textContent = `
.dashboard-attention li:has(.dashboard-attention__link){display:block;padding:0}
.dashboard-attention__link{width:100%;display:grid;grid-template-columns:8px minmax(0,1fr) 18px;gap:9px;align-items:center;border:0;padding:10px 0;background:transparent;color:var(--rp-ink-2);font:inherit;text-align:left;cursor:pointer}
.dashboard-attention__link:hover,.dashboard-attention__link:focus-visible{color:var(--rp-ink);background:color-mix(in oklch,var(--rp-pink-wash) 45%,transparent);outline:none}
.dashboard-attention__arrow{justify-self:end;color:var(--rp-ink-3);font-size:19px;line-height:1;transition:transform 150ms ease,color 150ms ease}
.dashboard-attention__link:hover .dashboard-attention__arrow,.dashboard-attention__link:focus-visible .dashboard-attention__arrow{color:var(--rp-pink-strong);transform:translateX(2px)}
.rp-attention-target{position:relative;z-index:1;animation:rpAttentionPulse 2.6s ease both}
@keyframes rpAttentionPulse{0%,100%{box-shadow:inherit}18%,68%{box-shadow:0 0 0 3px color-mix(in oklch,var(--rp-pink) 38%,transparent),0 12px 34px rgb(68 40 32 / 10%)}}
@media(prefers-reduced-motion:reduce){.rp-attention-target{animation:none;outline:3px solid color-mix(in oklch,var(--rp-pink) 38%,transparent);outline-offset:2px}}
`;
document.head.append(style);

const observer = new MutationObserver(records => {
  for (const record of records) {
    for (const node of record.addedNodes) {
      if (node instanceof Element) enhance(node);
    }
  }
});
observer.observe(document.documentElement, { childList: true, subtree: true });
enhance();
