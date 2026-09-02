import "/assets/js/product-transparency.js";
import { adminApi } from "./api.js";
import { renderDashboard, invalidateDashboardCache } from "./dashboard.js";
import { renderProducts } from "./products.js";
import { renderOrders } from "./orders.js";
import { renderAdmins } from "./admins.js";
import { renderStore } from "./store.js";
import { setupProfileMenu } from "./profile-menu.js";
import { setupSidebarBadges } from "./sidebar-badges.js";
import { setupNotificationMenu } from "./notifications.js";
import "./product-images.js";
import "./store-home-images.js";
import "./pix-real-diagnostic.js";

function ensureHeadLink(rel, href, extras = {}) {
  let link = document.head.querySelector(`link[rel="${rel}"][href="${href}"]`);
  if (!link) {
    link = document.createElement("link");
    link.rel = rel;
    link.href = href;
    document.head.appendChild(link);
  }
  Object.assign(link, extras);
}

function ensureMeta(name, content) {
  let meta = document.head.querySelector(`meta[name="${name}"]`);
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = name;
    document.head.appendChild(meta);
  }
  meta.content = content;
}

function setupPwaShell() {
  ensureHeadLink("manifest", "/admin/manifest.webmanifest");
  ensureHeadLink("icon", "/admin-favicon.png");
  ensureHeadLink("apple-touch-icon", "/admin-apple-touch-icon.png");
  ensureHeadLink("stylesheet", "/admin/redesign/assets/css/pwa-shell.css");
  ensureHeadLink("stylesheet", "/admin/redesign/assets/css/product-images.css");
  ensureHeadLink("stylesheet", "/admin/redesign/assets/css/store-home-images.css");
  ensureHeadLink("stylesheet", "/admin/redesign/assets/css/orders-queue-mobile.css");
  ensureMeta("theme-color", "#fff8f2");
  ensureMeta("apple-mobile-web-app-capable", "yes");
  ensureMeta("apple-mobile-web-app-status-bar-style", "default");
  ensureMeta("apple-mobile-web-app-title", "R&P Admin");
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/admin/sw.js", { scope: "/admin/" }).catch(() => {});
  }
}

setupPwaShell();

const app = document.querySelector("[data-admin-app]");
const collapseButton = document.querySelector("[data-collapse-sidebar]");
const navItems = [...document.querySelectorAll("[data-admin-nav]")];
const title = document.querySelector("[data-page-title]");
const subtitle = document.querySelector("[data-page-subtitle]");
const content = document.querySelector("[data-admin-content]");
const notificationButton = document.querySelector("[data-notifications-button]");
const profileButton = document.querySelector(".admin-profile");
const profileName = document.querySelector("[data-profile-name]");
const profileRole = document.querySelector("[data-profile-role]");
const profileAvatar = document.querySelector("[data-profile-avatar]");
const publicSiteLink = document.querySelector('.admin-topbar__actions a.admin-icon[href="/"]');

const pages = {
  dashboard: ["Dashboard", "Visão geral da operação"],
  produtos: ["Produtos", "Catálogo, categorias, estoque e promoções"],
  pedidos: ["Pedidos", "Fila atual, histórico e andamento"],
  admins: ["Administradores", "Acessos, perfis e segurança"],
  loja: ["Loja", "Configurações operacionais do cardápio público"]
};

const pageViews = new Map();
const pageRefreshes = new Map();
const PAGE_VIEW_TTL = 30_000;
const ORDERS_VIEW_TTL = 15_000;

let currentPage = null;
let mountedPage = null;
let currentUser = null;
let navigationId = 0;

function setCollapsed(collapsed) {
  app?.classList.toggle("is-collapsed", collapsed);
  collapseButton?.setAttribute("aria-expanded", String(!collapsed));
  collapseButton?.setAttribute("aria-label", collapsed ? "Expandir sidebar" : "Recolher sidebar");
  collapseButton?.setAttribute("title", collapsed ? "Expandir" : "Recolher");
  localStorage.setItem("rp-admin-sidebar-collapsed", collapsed ? "1" : "0");
}

function initials(name = "") {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "RP";
  return parts.slice(0, 2).map(part => part[0]).join("").toUpperCase();
}

function applyUser(user) {
  currentUser = user;
  if (profileName) profileName.textContent = user?.nome || user?.username || "Administrador";
  if (profileRole) profileRole.textContent = String(user?.papel || "ADMIN").toUpperCase();
  if (profileAvatar) {
    profileAvatar.replaceChildren();
    if (user?.avatar_url) {
      const image = document.createElement("img");
      image.src = user.avatar_url;
      image.alt = "";
      profileAvatar.appendChild(image);
    } else {
      profileAvatar.textContent = initials(user?.nome || user?.username);
    }
  }
}

function redirectToLogin() {
  const destination = encodeURIComponent(`${location.pathname}${location.search}${location.hash}`);
  location.replace(`/admin/login.html?return=${destination}`);
}

function pageTtl(page) {
  return page === "pedidos" ? ORDERS_VIEW_TTL : PAGE_VIEW_TTL;
}

function isViewFresh(page, view) {
  return Boolean(view && !view.invalidated && Date.now() - view.updatedAt < pageTtl(page));
}

function cacheMountedView() {
  if (!content || !mountedPage || !content.childNodes.length) return;
  const existing = pageViews.get(mountedPage) || {};
  pageViews.set(mountedPage, {
    ...existing,
    nodes: [...content.childNodes],
    updatedAt: existing.updatedAt || Date.now(),
    invalidated: Boolean(existing.invalidated)
  });
}

function restoreView(page, view) {
  if (!content || !view?.nodes?.length) return false;
  content.replaceChildren(...view.nodes);
  mountedPage = page;
  return true;
}

function looksLikeRefreshError(target) {
  const text = String(target?.textContent || "").toLowerCase();
  return text.includes("não foi possível carregar") || text.includes("falha ao carregar") || text.includes("tente novamente em instantes");
}

async function renderPage(page, target = content, { isActive = () => currentPage === page } = {}) {
  if (!target) return;
  if (page === "dashboard") return renderDashboard(target, { onUnauthorized: redirectToLogin, onNavigate: setPage, isActive });
  if (page === "produtos") return renderProducts(target, { onUnauthorized: redirectToLogin });
  if (page === "pedidos") return renderOrders(target, { onUnauthorized: redirectToLogin });
  if (page === "admins") return renderAdmins(target, { onUnauthorized: redirectToLogin, currentUser });
  if (page === "loja") return renderStore(target, { onUnauthorized: redirectToLogin });
}

function rememberRenderedView(page, target = content) {
  if (!target) return;
  pageViews.set(page, { nodes: [...target.childNodes], updatedAt: Date.now(), invalidated: false });
}

function refreshViewInBackground(page) {
  if (pageRefreshes.has(page)) return pageRefreshes.get(page);
  const staging = document.createElement("div");
  const refresh = renderPage(page, staging, { isActive: () => currentPage === page })
    .then(() => {
      if (looksLikeRefreshError(staging)) return;
      const nodes = [...staging.childNodes];
      if (!nodes.length) return;
      const freshView = { nodes, updatedAt: Date.now(), invalidated: false };
      pageViews.set(page, freshView);
      if (currentPage === page && mountedPage === page && content) {
        content.replaceChildren(...nodes);
        freshView.nodes = [...content.childNodes];
      }
    })
    .catch(error => {
      if (error?.status === 401) redirectToLogin();
      else console.warn(`R&P Admin: atualização silenciosa de ${page} falhou.`, error);
    })
    .finally(() => pageRefreshes.delete(page));
  pageRefreshes.set(page, refresh);
  return refresh;
}

async function showPage(page, id) {
  if (!content) return;
  const cached = pageViews.get(page);
  if (cached?.nodes?.length) {
    restoreView(page, cached);
    if (!isViewFresh(page, cached)) refreshViewInBackground(page);
    return;
  }

  const staging = document.createElement("div");
  await renderPage(page, staging, { isActive: () => id === navigationId && currentPage === page });
  if (id !== navigationId || currentPage !== page) return;
  if (looksLikeRefreshError(staging)) {
    content.replaceChildren(...staging.childNodes);
    mountedPage = page;
    return;
  }
  content.replaceChildren(...staging.childNodes);
  mountedPage = page;
  rememberRenderedView(page);
}

function invalidateViews(pageNames = []) {
  for (const page of pageNames) {
    const view = pageViews.get(page);
    if (view) view.invalidated = true;
    if (page === "dashboard") invalidateDashboardCache();
  }
}

window.addEventListener("rp-admin-data-changed", event => {
  const changed = Array.isArray(event.detail?.pages) ? event.detail.pages : [];
  invalidateViews(changed);
});

function waitForTransition(element, timeout = 140) {
  return new Promise(resolve => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      element.removeEventListener("transitionend", onEnd);
      resolve();
    };
    const onEnd = event => {
      if (event.target === element && event.propertyName === "opacity") finish();
    };
    element.addEventListener("transitionend", onEnd);
    setTimeout(finish, timeout);
  });
}

async function transitionToPage(page, id) {
  if (!content) return;
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!reducedMotion && content.childElementCount) {
    content.classList.remove("is-page-entering");
    content.classList.add("is-page-leaving");
    await waitForTransition(content);
    if (id !== navigationId) return;
  }
  cacheMountedView();
  content.replaceChildren();
  content.classList.remove("is-page-leaving");
  const showPromise = showPage(page, id);
  if (!reducedMotion) {
    content.classList.add("is-page-entering");
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (id === navigationId) content.classList.remove("is-page-entering");
    }));
  }
  await showPromise;
}

function setPage(page) {
  const resolvedPage = Object.hasOwn(pages, page) ? page : "dashboard";
  if (resolvedPage === currentPage) return;
  const meta = pages[resolvedPage];
  currentPage = resolvedPage;
  const id = ++navigationId;
  navItems.forEach(item => {
    const active = item.dataset.adminNav === resolvedPage;
    item.classList.toggle("is-active", active);
    if (active) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
  });
  if (title) title.textContent = meta[0];
  if (subtitle) subtitle.textContent = meta[1];
  history.replaceState(null, "", `#${resolvedPage}`);
  transitionToPage(resolvedPage, id).catch(error => console.error("R&P Admin: falha ao trocar de página.", error));
}

collapseButton?.addEventListener("click", () => setCollapsed(!app?.classList.contains("is-collapsed")));
publicSiteLink?.addEventListener("click", event => { event.preventDefault(); location.assign("/"); });
navItems.forEach(item => item.addEventListener("click", () => setPage(item.dataset.adminNav)));

const tooltip = document.createElement("div");
tooltip.className = "admin-tooltip";
tooltip.setAttribute("role", "tooltip");
document.body.appendChild(tooltip);
let tooltipTarget = null;
function hideTooltip() { tooltipTarget = null; tooltip.classList.remove("is-visible"); }
function showTooltip(item) {
  if (!app?.classList.contains("is-collapsed") || matchMedia("(max-width: 860px)").matches) return;
  const label = item.dataset.label;
  if (!label) return;
  tooltipTarget = item;
  tooltip.textContent = label;
  tooltip.classList.add("is-visible");
  const rect = item.getBoundingClientRect();
  const tipRect = tooltip.getBoundingClientRect();
  tooltip.style.left = `${Math.round(rect.right + 10)}px`;
  tooltip.style.top = `${Math.round(rect.top + (rect.height - tipRect.height) / 2)}px`;
}
navItems.forEach(item => {
  item.addEventListener("mouseenter", () => showTooltip(item));
  item.addEventListener("mouseleave", hideTooltip);
  item.addEventListener("focus", () => showTooltip(item));
  item.addEventListener("blur", hideTooltip);
});
window.addEventListener("resize", hideTooltip);
window.addEventListener("hashchange", () => {
  const requested = location.hash.slice(1);
  if (requested !== currentPage && Object.hasOwn(pages, requested)) setPage(requested);
});

async function bootstrap() {
  setCollapsed(localStorage.getItem("rp-admin-sidebar-collapsed") === "1");
  try {
    const payload = await adminApi.me();
    if (!payload?.autenticado || !payload?.usuario) return redirectToLogin();
    applyUser(payload.usuario);
    setupProfileMenu(profileButton, payload.usuario, { onUnauthorized: redirectToLogin });
    setupNotificationMenu(notificationButton, { onUnauthorized: redirectToLogin });
    setupSidebarBadges({ onUnauthorized: redirectToLogin });
  } catch (error) {
    if (error?.status === 401) return redirectToLogin();
    console.warn("R&P Admin: não foi possível validar a sessão do redesign.", error);
  }
  const initialPage = location.hash.slice(1);
  setPage(Object.hasOwn(pages, initialPage) ? initialPage : "dashboard");
}

bootstrap();