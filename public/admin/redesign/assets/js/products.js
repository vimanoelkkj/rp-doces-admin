import { adminApi } from "./api.js";

const CATEGORY_LABELS = {
  BOLO_NO_POTE: "Bolos no pote",
  MINI_PUDIM: "Mini pudins"
};

const EMOJI_OPTIONS = [
  ["🍰", "Bolo"],
  ["🧁", "Cupcake"],
  ["🍮", "Pudim"],
  ["🎂", "Bolo de festa"],
  ["🍓", "Morango"],
  ["🍫", "Chocolate"],
  ["🥥", "Coco"],
  ["🍋", "Limão"],
  ["🍯", "Mel"],
  ["🍪", "Biscoito"]
];

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
  if (available <= 3)
    return { label: `${available} em estoque`, className: "is-warning", available };
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
  const text =
    filter === "todos"
      ? "Nenhum produto cadastrado ainda."
      : "Nenhum produto corresponde a este filtro.";
  return `<div class="products-empty"><strong>Nada por aqui</strong><span>${text}</span></div>`;
}

function emojiPicker() {
  return `
    <fieldset class="products-field products-field--wide products-emoji-field">
      <legend>Emoji</legend>
      <input name="emoji" type="hidden" value="${EMOJI_OPTIONS[0][0]}" data-emoji-value />
      <div class="products-emoji-picker" role="radiogroup" aria-label="Escolha um emoji para o produto">
        ${EMOJI_OPTIONS.map(
          ([emoji, label], index) => `
            <button
              class="products-emoji-option${index === 0 ? " is-selected" : ""}"
              type="button"
              role="radio"
              aria-checked="${index === 0 ? "true" : "false"}"
              aria-label="${label}"
              title="${label}"
              data-emoji-option="${emoji}"
            ><span aria-hidden="true">${emoji}</span><small>${label}</small></button>`
        ).join("")}
      </div>
    </fieldset>`;
}

function productDialog() {
  return `
    <div class="products-dialog" data-product-dialog hidden>
      <button class="products-dialog__backdrop" type="button" data-product-dialog-close aria-label="Fechar cadastro"></button>
      <section class="products-dialog__panel" role="dialog" aria-modal="true" aria-labelledby="new-product-title">
        <div class="products-dialog__head">
          <div>
            <span class="products-dialog__eyebrow">Catálogo</span>
            <h2 id="new-product-title">Novo produto</h2>
            <p>Cadastre um doce e ele já entra no catálogo administrativo.</p>
          </div>
          <button class="products-dialog__close" type="button" data-product-dialog-close aria-label="Fechar">×</button>
        </div>

        <form class="products-form" data-product-form autocomplete="off">
          <div class="products-form__grid">
            <label class="products-field products-field--wide">
              <span>Nome</span>
              <input name="nome" type="text" maxlength="100" required autocomplete="off" placeholder="Ex.: Bolo no pote de morango" />
            </label>

            <label class="products-field">
              <span>Categoria</span>
              <select name="categoria" required>
                <option value="BOLO_NO_POTE">Bolos no pote</option>
                <option value="MINI_PUDIM">Mini pudins</option>
              </select>
            </label>

            <label class="products-field">
              <span>Estoque</span>
              <input name="estoque" type="number" min="0" max="100000" step="1" value="0" required autocomplete="off" />
            </label>

            ${emojiPicker()}

            <label class="products-field products-field--wide">
              <span>Preço</span>
              <div class="products-money-field"><span>R$</span><input name="preco" type="text" inputmode="decimal" required placeholder="12,00" autocomplete="off" /></div>
            </label>

            <label class="products-field products-field--wide">
              <span>Descrição</span>
              <textarea name="descricao" maxlength="500" rows="4" placeholder="Uma descrição curta do produto." autocomplete="off"></textarea>
            </label>
          </div>

          <div class="products-form__toggles">
            <label class="products-toggle"><input name="ativo" type="checkbox" checked /><span><strong>Produto ativo</strong><small>Disponível para aparecer no catálogo.</small></span></label>
            <label class="products-toggle"><input name="destaque" type="checkbox" /><span><strong>Marcar como destaque</strong><small>Exibe o selo de destaque no produto.</small></span></label>
          </div>

          <div class="products-form__message" data-product-form-message aria-live="polite"></div>

          <div class="products-form__actions">
            <button class="products-secondary" type="button" data-product-dialog-close>Cancelar</button>
            <button class="products-primary" type="submit" data-product-submit>Salvar produto</button>
          </div>
        </form>
      </section>
    </div>`;
}

function parseMoneyToCents(value) {
  const normalized = String(value || "")
    .trim()
    .replace(/\s/g, "")
    .replace(/R\$/gi, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const cents = Math.round(amount * 100);
  return Number.isSafeInteger(cents) ? cents : null;
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
          <button class="products-primary" type="button" data-new-product>+ Novo produto</button>
        </div>
      </div>
      <div class="products-summary" data-products-summary>Carregando catálogo…</div>
      <div class="products-grid" data-products-grid></div>
    </section>
    ${productDialog()}`;

  const view = container.querySelector(".products-view");
  const grid = container.querySelector("[data-products-grid]");
  const summary = container.querySelector("[data-products-summary]");
  const search = container.querySelector("[data-products-search]");
  const filterButtons = [...container.querySelectorAll("[data-products-filter]")];
  const newProductButton = container.querySelector("[data-new-product]");
  const dialog = container.querySelector("[data-product-dialog]");
  const dialogPanel = dialog?.querySelector(".products-dialog__panel");
  const form = container.querySelector("[data-product-form]");
  const formMessage = container.querySelector("[data-product-form-message]");
  const submitButton = container.querySelector("[data-product-submit]");
  const emojiValue = container.querySelector("[data-emoji-value]");
  const emojiOptions = [...container.querySelectorAll("[data-emoji-option]")];

  let products = [];
  let filter = "todos";
  let query = "";
  let lastFocused = null;

  function selectEmoji(value) {
    if (emojiValue instanceof HTMLInputElement) emojiValue.value = value;
    emojiOptions.forEach(button => {
      const selected = button.dataset.emojiOption === value;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-checked", String(selected));
    });
  }

  function renderList() {
    const visible = products.filter(product => {
      const available = stockState(product).available;
      const matchesQuery =
        !query || `${product.nome} ${product.descricao || ""}`.toLowerCase().includes(query);
      if (!matchesQuery) return false;
      if (filter === "ativos") return Number(product.ativo) === 1;
      if (filter === "esgotados") return Number(product.ativo) === 1 && available <= 0;
      if (filter === "arquivados") return Number(product.ativo) === 0;
      return true;
    });

    const activeCount = products.filter(product => Number(product.ativo) === 1).length;
    const soldOutCount = products.filter(
      product => Number(product.ativo) === 1 && stockState(product).available <= 0
    ).length;
    if (summary)
      summary.textContent = `${products.length} produtos · ${activeCount} ativos · ${soldOutCount} esgotados`;
    if (grid)
      grid.innerHTML = visible.length ? visible.map(productCard).join("") : emptyState(filter);
  }

  async function refreshProducts() {
    const payload = await adminApi.products();
    products = Array.isArray(payload?.produtos) ? payload.produtos : [];
    renderList();
  }

  function resetDialogScroll() {
    if (dialog instanceof HTMLElement) dialog.scrollTop = 0;
    if (dialogPanel instanceof HTMLElement) dialogPanel.scrollTop = 0;
  }

  function openDialog() {
    if (!dialog) return;
    lastFocused = document.activeElement;
    dialog.hidden = false;
    document.body.classList.add("products-dialog-open");
    form?.reset();
    selectEmoji(EMOJI_OPTIONS[0][0]);
    const active = form?.elements.namedItem("ativo");
    if (active instanceof HTMLInputElement) active.checked = true;
    const stock = form?.elements.namedItem("estoque");
    if (stock instanceof HTMLInputElement) stock.value = "0";
    if (formMessage) formMessage.textContent = "";

    resetDialogScroll();
    requestAnimationFrame(() => {
      resetDialogScroll();
    });
  }

  function closeDialog() {
    if (!dialog || dialog.hidden) return;
    resetDialogScroll();
    dialog.hidden = true;
    document.body.classList.remove("products-dialog-open");
    if (formMessage) formMessage.textContent = "";
    if (lastFocused instanceof HTMLElement) lastFocused.focus();
  }

  search?.addEventListener("input", event => {
    query = String(event.target.value || "")
      .trim()
      .toLowerCase();
    renderList();
  });

  filterButtons.forEach(button => {
    button.addEventListener("click", () => {
      filter = button.dataset.productsFilter || "todos";
      filterButtons.forEach(item => item.classList.toggle("is-active", item === button));
      renderList();
    });
  });

  emojiOptions.forEach(button => {
    button.addEventListener("click", () =>
      selectEmoji(button.dataset.emojiOption || EMOJI_OPTIONS[0][0])
    );
  });

  newProductButton?.addEventListener("click", openDialog);
  container.querySelectorAll("[data-product-dialog-close]").forEach(button => {
    button.addEventListener("click", closeDialog);
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && dialog && !dialog.hidden) closeDialog();
  });

  form?.addEventListener("submit", async event => {
    event.preventDefault();
    if (!form || !submitButton) return;

    const data = new FormData(form);
    const nome = String(data.get("nome") || "").trim();
    const categoria = String(data.get("categoria") || "").trim();
    const estoque = Number(data.get("estoque"));
    const precoCentavos = parseMoneyToCents(data.get("preco"));
    const descricao = String(data.get("descricao") || "").trim();
    const emoji = String(data.get("emoji") || "").trim();

    if (!nome) {
      if (formMessage) formMessage.textContent = "Informe o nome do produto.";
      return;
    }
    if (!categoria) {
      if (formMessage) formMessage.textContent = "Selecione uma categoria.";
      return;
    }
    if (!Number.isInteger(estoque) || estoque < 0) {
      if (formMessage) formMessage.textContent = "Informe um estoque válido.";
      return;
    }
    if (!precoCentavos) {
      if (formMessage) formMessage.textContent = "Informe um preço válido.";
      return;
    }

    submitButton.disabled = true;
    submitButton.textContent = "Salvando…";
    if (formMessage) formMessage.textContent = "";

    try {
      await adminApi.createProduct({
        nome,
        categoria,
        estoque,
        preco_centavos: precoCentavos,
        descricao,
        emoji,
        ativo: Boolean(data.get("ativo")),
        destaque: Boolean(data.get("destaque"))
      });
      await refreshProducts();
      closeDialog();
    } catch (error) {
      if (error?.status === 401) {
        onUnauthorized?.();
        return;
      }
      if (formMessage)
        formMessage.textContent = error?.message || "Não foi possível salvar o produto.";
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = "Salvar produto";
    }
  });

  try {
    await refreshProducts();
    view?.setAttribute("aria-busy", "false");
  } catch (error) {
    if (error?.status === 401) {
      onUnauthorized?.();
      return;
    }
    if (summary) summary.textContent = "Não foi possível carregar o catálogo.";
    if (grid)
      grid.innerHTML = `<div class="products-empty is-error"><strong>Erro ao carregar</strong><span>${esc(error?.message || "Tente novamente em instantes.")}</span></div>`;
    view?.setAttribute("aria-busy", "false");
  }
}
