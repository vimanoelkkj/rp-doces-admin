import { adminApi } from "./api.js";
import { renderDashboard } from "./dashboard.js";
import { renderProducts } from "./products.js";

const app = document.querySelector('[data-admin-app]');
const collapseButton = document.querySelector('[data-collapse-sidebar]');
const navItems = [...document.querySelectorAll('[data-admin-nav]')];
const title = document.querySelector('[data-page-title]');
const subtitle = document.querySelector('[data-page-subtitle]');
const content = document.querySelector('[data-admin-content]');
const profileName = document.querySelector('[data-profile-name]');
const profileRole = document.querySelector('[data-profile-role]');
const profileAvatar = document.querySelector('[data-profile-avatar]');

const pages = {
  dashboard: ['Dashboard', 'Visão geral da operação'],
  produtos: ['Produtos', 'Catálogo, categorias, estoque e promoções'],
  pedidos: ['Pedidos', 'Fila atual, histórico e andamento'],
  admins: ['Administradores', 'Acessos, perfis e segurança'],
  loja: ['Loja', 'Configurações operacionais do cardápio público']
};

let currentPage = null;
let currentUser = null;

function setCollapsed(collapsed) {
  app?.classList.toggle('is-collapsed', collapsed);
  collapseButton?.setAttribute('aria-expanded', String(!collapsed));
  localStorage.setItem('rp-admin-sidebar-collapsed', collapsed ? '1' : '0');
}

function initials(name = '') {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'RP';
  return parts.slice(0, 2).map(part => part[0]).join('').toUpperCase();
}

function applyUser(user) {
  currentUser = user;
  if (profileName) profileName.textContent = user?.nome || user?.username || 'Administrador';
  if (profileRole) profileRole.textContent = String(user?.papel || 'ADMIN').toUpperCase();
  if (profileAvatar) profileAvatar.textContent = initials(user?.nome || user?.username);
}

function redirectToLogin() {
  const destination = encodeURIComponent('/admin/redesign/');
  location.assign(`/admin/?return=${destination}`);
}

function renderPlaceholder(page) {
  if (!content) return;
  const [pageTitle] = pages[page] || pages.dashboard;
  content.innerHTML = `
    <section class="admin-panel admin-placeholder">
      <div>
        <strong>${pageTitle}</strong>
        <span>O novo shell já está usando a sessão real. A integração desta tela entra na próxima etapa.</span>
      </div>
    </section>`;
}

async function renderPage(page) {
  if (!content) return;
  if (page === 'dashboard') {
    await renderDashboard(content, {
      onUnauthorized: redirectToLogin,
      onNavigate: setPage
    });
    return;
  }
  if (page === 'produtos') {
    await renderProducts(content, { onUnauthorized: redirectToLogin });
    return;
  }
  renderPlaceholder(page);
}

function setPage(page) {
  const resolvedPage = Object.hasOwn(pages, page) ? page : 'dashboard';
  const meta = pages[resolvedPage];
  currentPage = resolvedPage;

  navItems.forEach(item => {
    const active = item.dataset.adminNav === resolvedPage;
    item.classList.toggle('is-active', active);
    if (active) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  });

  if (title) title.textContent = meta[0];
  if (subtitle) subtitle.textContent = meta[1];
  history.replaceState(null, '', `#${resolvedPage}`);
  renderPage(resolvedPage);
}

collapseButton?.addEventListener('click', () => {
  setCollapsed(!app?.classList.contains('is-collapsed'));
});

navItems.forEach(item => {
  item.addEventListener('click', () => setPage(item.dataset.adminNav));
});

const tooltip = document.createElement('div');
tooltip.className = 'admin-tooltip';
tooltip.setAttribute('role', 'tooltip');
document.body.appendChild(tooltip);
let tooltipTarget = null;

function hideTooltip() {
  tooltipTarget = null;
  tooltip.classList.remove('is-visible');
}

function showTooltip(item) {
  if (!app?.classList.contains('is-collapsed') || matchMedia('(max-width: 860px)').matches) return;
  const label = item.dataset.label;
  if (!label) return;
  tooltipTarget = item;
  tooltip.textContent = label;
  tooltip.classList.add('is-visible');
  const rect = item.getBoundingClientRect();
  const tipRect = tooltip.getBoundingClientRect();
  tooltip.style.left = `${Math.round(rect.right + 10)}px`;
  tooltip.style.top = `${Math.round(rect.top + (rect.height - tipRect.height) / 2)}px`;
}

navItems.forEach(item => {
  item.addEventListener('mouseenter', () => showTooltip(item));
  item.addEventListener('mouseleave', hideTooltip);
  item.addEventListener('focus', () => showTooltip(item));
  item.addEventListener('blur', hideTooltip);
});

window.addEventListener('resize', hideTooltip);
window.addEventListener('hashchange', () => {
  const requested = location.hash.slice(1);
  if (requested !== currentPage && Object.hasOwn(pages, requested)) setPage(requested);
});

async function bootstrap() {
  const storedCollapsed = localStorage.getItem('rp-admin-sidebar-collapsed') === '1';
  setCollapsed(storedCollapsed);

  try {
    const payload = await adminApi.me();
    if (!payload?.autenticado || !payload?.usuario) return redirectToLogin();
    applyUser(payload.usuario);
  } catch (error) {
    if (error?.status === 401) return redirectToLogin();
    console.warn('R&P Admin: não foi possível validar a sessão do redesign.', error);
  }

  const initialPage = location.hash.slice(1);
  setPage(Object.hasOwn(pages, initialPage) ? initialPage : 'dashboard');
}

bootstrap();
