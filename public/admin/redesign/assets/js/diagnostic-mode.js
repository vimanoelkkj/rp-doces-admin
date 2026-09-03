const UNLOCK_KEY = "rp-admin-diagnostics-unlocked";
const REQUIRED_TAPS = 7;

function isOwner() {
  return String(document.querySelector("[data-profile-role]")?.textContent || "").trim().toUpperCase() === "OWNER";
}

function diagnosticsUnlocked() {
  return sessionStorage.getItem(UNLOCK_KEY) === "1";
}

function ensureStyles() {
  if (document.getElementById("rp-admin-diagnostic-mode-style")) return;
  const style = document.createElement("style");
  style.id = "rp-admin-diagnostic-mode-style";
  style.textContent = `
    .profile-menu__about{border-top:1px solid var(--rp-line);padding-top:12px}
    .profile-menu__version,.profile-menu__diagnostic-open{width:100%;display:flex;align-items:center;justify-content:space-between;gap:12px;border:1px solid var(--rp-line);border-radius:12px;padding:10px 12px;background:#fff;color:var(--rp-ink-2);font:inherit;text-align:left}
    .profile-menu__version{cursor:default;user-select:none}
    .profile-menu__version strong,.profile-menu__diagnostic-open strong{display:block;font-size:11px;color:var(--rp-ink)}
    .profile-menu__version span,.profile-menu__diagnostic-open span{display:block;margin-top:2px;font-size:9.5px;color:var(--rp-ink-3)}
    .profile-menu__diagnostic-open{margin-top:8px;cursor:pointer;border-color:color-mix(in srgb,var(--rp-pink) 30%,var(--rp-line));background:var(--rp-pink-wash)}
    .profile-menu__diagnostic-open:hover{border-color:var(--rp-pink);color:var(--rp-pink-strong)}
    .profile-menu__diagnostic-status{min-height:0;margin-top:7px;font-size:9.5px;font-weight:800;color:var(--rp-success)}
    .profile-menu__diagnostic-status:empty{display:none}
    .diagnostic-page{padding:22px clamp(18px,3vw,42px) 42px;overflow:auto}
    .diagnostic-page[hidden]{display:none}
    .diagnostic-page__inner{width:min(1320px,100%);margin:0 auto}
    .diagnostic-page__toolbar{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:18px}
    .diagnostic-page__toolbar p{margin:4px 0 0;color:var(--rp-ink-3);font-size:12px;line-height:1.5}
    .diagnostic-page__toolbar button{min-height:38px;border:1px solid var(--rp-line);border-radius:11px;padding:0 14px;background:#fff;color:var(--rp-ink-2);font:inherit;font-size:10px;font-weight:900;cursor:pointer}
    .diagnostic-page__notice{margin-bottom:18px;border:1px solid var(--rp-line);border-radius:16px;padding:14px 16px;background:var(--rp-surface);color:var(--rp-ink-2);font-size:12px;line-height:1.55}
    .diagnostic-page__notice strong{color:var(--rp-ink)}
    .diagnostic-pix-host{padding:0}
    .diagnostic-page .store-grid{display:grid;grid-template-columns:1fr;gap:16px}
    @media(max-width:620px){.diagnostic-page{padding:16px 12px 96px}.diagnostic-page__toolbar{align-items:center}.diagnostic-page__toolbar p{font-size:11px}.diagnostic-page__notice{font-size:11px}}
  `;
  document.head.appendChild(style);
}

function closeProfileMenu(menu) {
  if (!menu) return;
  menu.hidden = true;
  const button = document.querySelector(".admin-profile");
  button?.classList.remove("is-open");
  button?.setAttribute("aria-expanded", "false");
}

function ensureDiagnosticPage() {
  let page = document.querySelector("[data-diagnostic-page]");
  if (page) return page;
  const main = document.querySelector(".admin-main");
  const content = document.querySelector("[data-admin-content]");
  if (!main || !content) return null;

  page = document.createElement("section");
  page.className = "diagnostic-page";
  page.dataset.diagnosticPage = "";
  page.hidden = true;
  page.innerHTML = `
    <div class="diagnostic-page__inner">
      <div class="diagnostic-page__toolbar">
        <div><strong>Ferramentas internas</strong><p>Testes reais de integrações e rotinas financeiras isoladas da operação.</p></div>
        <button type="button" data-diagnostic-close>Voltar</button>
      </div>
      <div class="diagnostic-page__notice"><strong>Área restrita ao OWNER.</strong> As rotas continuam protegidas no backend. O desbloqueio desta tela apenas revela as ferramentas nesta sessão.</div>
      <section class="diagnostic-pix-host" data-pix-diagnostic-host><div class="store-grid"></div></section>
    </div>`;
  main.insertBefore(page, content);
  page.querySelector("[data-diagnostic-close]")?.addEventListener("click", () => closeDiagnostics());
  return page;
}

let previousTitle = "";
let previousSubtitle = "";
let previousActiveNav = null;
let open = false;

function openDiagnostics() {
  if (!isOwner() || !diagnosticsUnlocked()) return;
  const page = ensureDiagnosticPage();
  const content = document.querySelector("[data-admin-content]");
  const title = document.querySelector("[data-page-title]");
  const subtitle = document.querySelector("[data-page-subtitle]");
  if (!page || !content) return;

  if (!open) {
    previousTitle = title?.textContent || "";
    previousSubtitle = subtitle?.textContent || "";
    previousActiveNav = document.querySelector("[data-admin-nav].is-active")?.dataset.adminNav || null;
  }
  open = true;
  content.hidden = true;
  page.hidden = false;
  document.querySelectorAll("[data-admin-nav]").forEach(item => {
    item.classList.remove("is-active");
    item.removeAttribute("aria-current");
  });
  if (title) title.textContent = "Diagnóstico";
  if (subtitle) subtitle.textContent = "Testes internos e integração financeira";
}

function closeDiagnostics() {
  if (!open) return;
  open = false;
  const page = document.querySelector("[data-diagnostic-page]");
  const content = document.querySelector("[data-admin-content]");
  const title = document.querySelector("[data-page-title]");
  const subtitle = document.querySelector("[data-page-subtitle]");
  if (page) page.hidden = true;
  if (content) content.hidden = false;
  if (title) title.textContent = previousTitle;
  if (subtitle) subtitle.textContent = previousSubtitle;
  if (previousActiveNav) {
    const item = document.querySelector(`[data-admin-nav="${previousActiveNav}"]`);
    item?.classList.add("is-active");
    item?.setAttribute("aria-current", "page");
  }
}

function enhanceProfileMenu() {
  const menu = document.querySelector(".profile-menu");
  if (!menu || menu.dataset.diagnosticReady === "1" || !isOwner()) return;
  menu.dataset.diagnosticReady = "1";
  const logout = menu.querySelector("[data-profile-logout]");
  if (!logout) return;

  const section = document.createElement("div");
  section.className = "profile-menu__section profile-menu__about";
  section.innerHTML = `
    <div class="profile-menu__section-head"><div><strong>Sobre o sistema</strong><span>Informações internas do painel administrativo.</span></div></div>
    <button type="button" class="profile-menu__version" data-diagnostic-unlock-target>
      <span><strong>R&P Admin</strong><span>Redesign operacional</span></span><span aria-hidden="true">●</span>
    </button>
    <button type="button" class="profile-menu__diagnostic-open" data-diagnostic-open ${diagnosticsUnlocked() ? "" : "hidden"}>
      <span><strong>🧪 Diagnóstico</strong><span>Pix real, webhook, reembolso e idempotência.</span></span><span aria-hidden="true">›</span>
    </button>
    <div class="profile-menu__diagnostic-status" data-diagnostic-status></div>`;
  logout.before(section);

  const target = section.querySelector("[data-diagnostic-unlock-target]");
  const openButton = section.querySelector("[data-diagnostic-open]");
  const status = section.querySelector("[data-diagnostic-status]");
  let taps = 0;
  let resetTimer = null;

  target?.addEventListener("click", () => {
    if (diagnosticsUnlocked()) return;
    taps += 1;
    clearTimeout(resetTimer);
    resetTimer = setTimeout(() => {
      taps = 0;
      if (status) status.textContent = "";
    }, 3000);

    if (taps >= REQUIRED_TAPS) {
      sessionStorage.setItem(UNLOCK_KEY, "1");
      if (openButton) openButton.hidden = false;
      if (status) status.textContent = "Modo de diagnóstico ativado nesta sessão.";
      navigator.vibrate?.(35);
      taps = 0;
      return;
    }
    if (taps >= 4 && status) status.textContent = `Faltam ${REQUIRED_TAPS - taps} toques para ativar.`;
  });

  openButton?.addEventListener("click", () => {
    closeProfileMenu(menu);
    openDiagnostics();
  });
  logout.addEventListener("click", () => sessionStorage.removeItem(UNLOCK_KEY), { capture: true });
}

ensureStyles();
enhanceProfileMenu();

let queued = false;
const observer = new MutationObserver(() => {
  if (queued) return;
  queued = true;
  queueMicrotask(() => {
    queued = false;
    enhanceProfileMenu();
  });
});
observer.observe(document.documentElement, { childList: true, subtree: true });

document.addEventListener("click", event => {
  if (open && event.target.closest("[data-admin-nav]")) closeDiagnostics();
}, true);
