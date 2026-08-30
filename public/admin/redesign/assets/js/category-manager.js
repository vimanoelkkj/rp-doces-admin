import { adminApi } from "./api.js";

const CATEGORIES = [
  {
    id: "BOLO_NO_POTE",
    label: "Bolos no pote",
    description: "Categoria estrutural usada pela seção de bolos do cardápio público.",
    emoji: "🍰"
  },
  {
    id: "MINI_PUDIM",
    label: "Mini pudins",
    description: "Categoria estrutural usada pela seção de mini pudins do cardápio público.",
    emoji: "🍮"
  }
];

function categoryStats(products, categoryId) {
  const categoryProducts = products.filter(product => product.categoria === categoryId);
  const active = categoryProducts.filter(product => Number(product.ativo) === 1).length;
  const archived = categoryProducts.length - active;
  return { total: categoryProducts.length, active, archived };
}

function categoryCard(category, stats) {
  return `
    <article class="category-manager__card">
      <div class="category-manager__icon" aria-hidden="true">${category.emoji}</div>
      <div class="category-manager__copy">
        <div class="category-manager__title-row">
          <div>
            <strong>${category.label}</strong>
            <code>${category.id}</code>
          </div>
          <span class="category-manager__system-badge">Sistema</span>
        </div>
        <p>${category.description}</p>
        <div class="category-manager__stats" aria-label="Resumo da categoria ${category.label}">
          <span><strong>${stats.total}</strong> produtos</span>
          <span><strong>${stats.active}</strong> ativos</span>
          <span><strong>${stats.archived}</strong> arquivados</span>
        </div>
      </div>
    </article>`;
}

function createDialog(products) {
  const dialog = document.createElement("div");
  dialog.className = "category-manager";
  dialog.dataset.categoryManager = "";
  dialog.innerHTML = `
    <button class="category-manager__backdrop" type="button" data-category-manager-close aria-label="Fechar categorias"></button>
    <section class="category-manager__panel" role="dialog" aria-modal="true" aria-labelledby="category-manager-title">
      <div class="category-manager__head">
        <div>
          <span>Catálogo</span>
          <h2 id="category-manager-title">Gerenciar categorias</h2>
          <p>As categorias atuais ainda são estruturais no cardápio público.</p>
        </div>
        <button class="category-manager__close" type="button" data-category-manager-close aria-label="Fechar">×</button>
      </div>

      <div class="category-manager__notice">
        <strong>Por enquanto, estas categorias são fixas.</strong>
        <span>O storefront ainda possui seções específicas para bolos no pote e mini pudins. Criar uma terceira categoria só será liberado quando o cardápio público passar a renderizar categorias dinamicamente.</span>
      </div>

      <div class="category-manager__list">
        ${CATEGORIES.map(category => categoryCard(category, categoryStats(products, category.id))).join("")}
      </div>

      <div class="category-manager__footer">
        <span>2 categorias do sistema</span>
        <button class="products-secondary" type="button" data-category-manager-close>Fechar</button>
      </div>
    </section>`;
  return dialog;
}

async function openCategoryManager(button) {
  button.disabled = true;
  const previousLabel = button.textContent;
  button.textContent = "Carregando…";

  try {
    const payload = await adminApi.products();
    const products = Array.isArray(payload?.produtos) ? payload.produtos : [];
    document.querySelector("[data-category-manager]")?.remove();
    const dialog = createDialog(products);
    document.body.append(dialog);
    document.body.classList.add("category-manager-open");

    const close = () => {
      dialog.remove();
      document.body.classList.remove("category-manager-open");
      button.focus();
    };

    dialog.querySelectorAll("[data-category-manager-close]").forEach(item => {
      item.addEventListener("click", close);
    });

    const onKeydown = event => {
      if (event.key !== "Escape") return;
      document.removeEventListener("keydown", onKeydown);
      close();
    };
    document.addEventListener("keydown", onKeydown);
  } catch (error) {
    console.warn("R&P Admin: não foi possível carregar as categorias.", error);
  } finally {
    button.disabled = false;
    button.textContent = previousLabel;
  }
}

function enhanceCategoryManager(root = document) {
  root.querySelectorAll?.(".products-toolbar__actions .products-secondary").forEach(button => {
    if (!(button instanceof HTMLButtonElement)) return;
    if (!button.textContent?.includes("Gerenciar categorias")) return;
    if (button.dataset.categoryManagerEnhanced === "true") return;

    button.dataset.categoryManagerEnhanced = "true";
    button.disabled = false;
    button.addEventListener("click", () => openCategoryManager(button));
  });
}

enhanceCategoryManager();

const observer = new MutationObserver(() => enhanceCategoryManager());
observer.observe(document.body, { childList: true, subtree: true });
