const app = document.querySelector('[data-admin-app]');
const collapseButton = document.querySelector('[data-collapse-sidebar]');
const navItems = [...document.querySelectorAll('[data-admin-nav]')];
const title = document.querySelector('[data-page-title]');
const subtitle = document.querySelector('[data-page-subtitle]');
const content = document.querySelector('[data-admin-content]');

const pages = {
  dashboard: ['Dashboard', 'Visão geral da operação'],
  produtos: ['Produtos', 'Catálogo, categorias, estoque e promoções'],
  pedidos: ['Pedidos', 'Fila atual, histórico e andamento'],
  admins: ['Administradores', 'Acessos, perfis e segurança'],
  loja: ['Loja', 'Configurações operacionais do cardápio público']
};

function setCollapsed(collapsed) {
  app?.classList.toggle('is-collapsed', collapsed);
  collapseButton?.setAttribute('aria-expanded', String(!collapsed));
  localStorage.setItem('rp-admin-sidebar-collapsed', collapsed ? '1' : '0');
}

function renderPlaceholder(page) {
  if (!content) return;
  const [pageTitle] = pages[page] || pages.dashboard;
  content.innerHTML = `
    <section class="admin-panel admin-placeholder">
      <div>
        <strong>${pageTitle}</strong>
        <span>Estrutura do redesign ativa. A integração real desta tela entra na próxima etapa.</span>
      </div>
    </section>`;
}

function setPage(page) {
  const meta = pages[page] || pages.dashboard;
  navItems.forEach(item => {
    const active = item.dataset.adminNav === page;
    item.classList.toggle('is-active', active);
    item.setAttribute('aria-current', active ? 'page' : 'false');
  });
  if (title) title.textContent = meta[0];
  if (subtitle) subtitle.textContent = meta[1];
  renderPlaceholder(page);
  history.replaceState(null, '', `#${page}`);
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

const storedCollapsed = localStorage.getItem('rp-admin-sidebar-collapsed') === '1';
setCollapsed(storedCollapsed);
const initialPage = location.hash.slice(1);
setPage(Object.hasOwn(pages, initialPage) ? initialPage : 'dashboard');
