import { adminApi } from "./api.js";

const CATEGORY_LABELS = {
  BOLO_NO_POTE: "Bolos no pote",
  MINI_PUDIM: "Mini pudins"
};

function money(cents) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  }).format(Number(cents || 0) / 100);
}

function esc(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function promoLabel(product) {
  if (!Number(product.promocao_ativa)) return "";
  const now = Date.now();
  const start = product.promocao_inicio ? Date.parse(product.promocao_inicio) : null;
  const end = product.promocao_fim ? Date.parse(product.promocao_fim) : null;
  if (start && start > now) return "Promoção agendada";
  if (end && end < now) return "Promoção encerrada";
  return "Promoção ativa";
}

function stockState(product) {
  const stock = Number(product.estoque || 0);
  const reserved = Number(product.estoque_reservado || 0);
  const available = Math.max(0, stock - reserved);
  if (available <= 0) return { label: "Esgotado", className: "is-danger", available };
  if (available <= 3) return { label: `${available} em estoque`, className: "is-warning", available };
  return { label: `${available} em estoque`, className: "is-ok", available };
}

function productCard(product) {
  const stock = stockState(product);
  const promo = promoLabel(product);
  const promotionalPrice = Number(product.preco_promocional_centavos || 0);
  const hasPromoPrice = promo === "Promoção ativa" && promotionalPrice > 0;

  return `
    <article class="products-card" data-product-id="${product.id}">
      <div class="products-card__media">
        <div class="products-card__flags">
          ${Number(product.destaque) ? '<span class="products-badge is-highlight">Destaque</span>' : ""}
          ${!Number(product.ativo) ? '<span class="products-badge">Arquivado</span>' : ""}
        </div>
        <div class="products-card__placeholder" aria-label="Produto sem foto">
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m5 17 5-5 4 4 2-2 3 3"/></svg>
          <span>Sem foto</span>
        </div>
        ${promo ? `<span class="products-badge products-card__promo">${promo}</span>` : ""}
      </div>

      <div class="products-card__body">
        <div class="products-card__heading">
          <div>
            <span class="products-card__category">${esc(CATEGORY_LABELS[product.categoria] || product.categoria)}</span>
            <h3>${esc(product.nome)}</h3>
          </div>
          <button class="products-card__menu" type="button" aria-label="Ações de ${esc(product.nome)}" disabled>•••</button>
        </div>

        <p class="products-card__description">${esc(product.descricao || "Sem descrição cadastrada.")}</p>

        <div class="products-card__footer">
          <div class="products-price">
            ${hasPromoPrice ? `<s>${money(product.preco_centavos)}</s><strong>${money(promotionalPrice)}</strong>` : `<strong>${money(product.preco_centavos)}</strong>`}
          </div>
          <span class="products-stock ${stock.className}">${stock.label}</span>
        </div>
      </div>
    </article>`;
}

function emptyState(filter) {
  const text = filter === "todos"
    ? "Nenhum produto cadastrado ainda."
    : "Nenhum produto corresponde a este filtro.";
  return `<div class="products-empty"><strong>Nada por aqui</strong><span>${text}</span></div>`;
}

export async function renderProducts(container, { onUnauthorized } = {}) {
  container.innerHTML = `
    <section class="products-view" aria-busy="true">
      <div class="products-toolbar">
        <div class="products-toolbar__left">
          <label class="products-search">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>
            <input type="search" placeholder="Buscar produto" aria-label="Buscar produto" data-products-search />
          </label>
          <div class="products-filters" aria-label="Filtrar produtos">
            <button type="button" class="is-active" data-products-filter="todos">Todos</button>
            <button type="button" data-products-filter="ativos">Ativos</button>
            <button type="button" data-products-filter="esgotados">Esgotados</button>
            <button type="button" data-products-filter="arquivados">Arquivados</button>
          </div>
        </div>
        <div class="products-toolbar__actions">
          <button class="products-secondary" type="button" disabled>Gerenciar categorias</button>
          <button class="products-primary" type="button" disabled>+ Novo produto</button>
        </div>
      </div>
      <div class="products-summary" data-products-summary>Carregando catálogo…</div>
      <div class="products-grid" data-products-grid></div>
    </section>`;

  const view = container.querySelector(".products-view");
  const grid = container.querySelector("[data-products-grid]");
  const summary = container.querySelector("[data-products-summary]");
  const search = container.querySelector("[data-products-search]");
  const filterButtons = [...container.querySelectorAll("[data-products-filter]")];

  try {
    const payload = await adminApi.products();
    const products = Array.isArray(payload?.produtos) ? payload.produtos : [];
    let filter = "todos";
    let query = "";

    function renderList() {
      const visible = products.filter(product => {
        const available = stockState(product).available;
        const matchesQuery = !query || `${product.nome} ${product.descricao || ""}`.toLowerCase().includes(query);
        if (!matchesQuery) return false;
        if (filter === "ativos") return Number(product.ativo) === 1;
        if (filter === "esgotados") return Number(product.ativo) === 1 && available <= 0;
        if (filter === "arquivados") return Number(product.ativo) === 0;
        return true;
      });

      const activeCount = products.filter(product => Number(product.ativo) === 1).length;
      const soldOutCount = products.filter(product => Number(product.ativo) === 1 && stockState(product).available <= 0).length;
      summary.textContent = `${products.length} produtos · ${activeCount} ativos · ${soldOutCount} esgotados`;
      grid.innerHTML = visible.length ? visible.map(productCard).join("") : emptyState(filter);
    }

    search?.addEventListener("input", event => {
      query = String(event.target.value || "").trim().toLowerCase();
      renderList();
    });

    filterButtons.forEach(button => {
      button.addEventListener("click", () => {
        filter = button.dataset.productsFilter || "todos";
        filterButtons.forEach(item => item.classList.toggle("is-active", item === button));
        renderList();
      });
    });

    renderList();
    view?.setAttribute("aria-busy", "false");
  } catch (error) {
    if (error?.status === 401) return onUnauthorized?.();
    if (summary) summary.textContent = "Não foi possível carregar o catálogo.";
    if (grid) grid.innerHTML = `<div class="products-empty is-error"><strong>Falha ao carregar produtos</strong><span>${esc(error?.message || "Tente novamente em instantes.")}</span></div>`;
    view?.setAttribute("aria-busy", "false");
  }
}
