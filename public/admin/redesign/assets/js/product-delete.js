import { adminApi } from "./api.js";

function productId(card) {
  const id = Number(card?.dataset.productId);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function productName(card) {
  return card?.querySelector(".products-card__heading h3")?.textContent?.trim() || "este produto";
}

function isArchived(card) {
  return [...(card?.querySelectorAll(".products-badge") || [])].some(
    badge => badge.textContent?.trim().toLowerCase() === "arquivado"
  );
}

async function currentProduct(id) {
  const payload = await adminApi.products();
  return (payload?.produtos || []).find(product => Number(product.id) === id) || null;
}

function rerenderProducts() {
  const nav = document.querySelector('[data-admin-nav="produtos"]');
  if (nav instanceof HTMLButtonElement) nav.click();
}

function closeAllMenus(except = null) {
  document.querySelectorAll("[data-product-actions-menu]").forEach(menu => {
    if (menu === except) return;
    menu.hidden = true;
    const trigger = menu.parentElement?.querySelector(".products-card__menu");
    trigger?.setAttribute("aria-expanded", "false");
  });
}

function showDeleteConfirm(card, menu) {
  const name = productName(card);
  menu.innerHTML = `
    <div class="products-card__delete-confirm">
      <p>Excluir <strong>${name}</strong> permanentemente? Esta ação não pode ser desfeita.</p>
      <p class="products-card__delete-error" data-product-delete-error hidden></p>
      <div class="products-card__delete-actions">
        <button type="button" data-product-delete-cancel>Cancelar</button>
        <button class="is-danger" type="button" data-product-delete-confirm>Excluir</button>
      </div>
    </div>`;

  menu.querySelector("[data-product-delete-cancel]")?.addEventListener("click", event => {
    event.stopPropagation();
    menu.hidden = true;
    menu.parentElement?.querySelector(".products-card__menu")?.setAttribute("aria-expanded", "false");
  });

  menu.querySelector("[data-product-delete-confirm]")?.addEventListener("click", async event => {
    event.stopPropagation();
    const id = productId(card);
    if (!id) return;
    const button = event.currentTarget;
    const errorBox = menu.querySelector("[data-product-delete-error]");
    button.disabled = true;
    button.textContent = "Excluindo…";
    if (errorBox) errorBox.hidden = true;

    try {
      await adminApi.deleteProductPermanently(id);
      rerenderProducts();
    } catch (error) {
      if (errorBox) {
        errorBox.textContent = error?.message || "Não foi possível excluir o produto.";
        errorBox.hidden = false;
      }
      button.disabled = false;
      button.textContent = "Excluir";
    }
  });
}

function populateMenu(card, menu) {
  const archived = isArchived(card);
  menu.innerHTML = `
    <button type="button" data-product-archive-action>${archived ? "Restaurar" : "Arquivar"}</button>
    <button class="is-danger" type="button" data-product-delete-action>Excluir permanentemente</button>`;

  menu.querySelector("[data-product-archive-action]")?.addEventListener("click", async event => {
    event.stopPropagation();
    const id = productId(card);
    if (!id) return;
    const button = event.currentTarget;
    button.disabled = true;

    try {
      if (archived) {
        const product = await currentProduct(id);
        if (!product) throw new Error("Produto não encontrado.");
        await adminApi.reactivateProduct(id, {
          nome: product.nome,
          categoria: product.categoria,
          descricao: product.descricao,
          preco_centavos: product.preco_centavos,
          disponivel: true,
          ativo: true,
          destaque: Boolean(product.destaque),
          emoji: product.emoji || "",
          estoque: Number(product.estoque || 0),
          promocao_ativa: Boolean(product.promocao_ativa),
          preco_promocional_centavos: product.preco_promocional_centavos ?? null,
          promocao_inicio: product.promocao_inicio ?? null,
          promocao_fim: product.promocao_fim ?? null
        });
      } else {
        await adminApi.archiveProduct(id);
      }
      rerenderProducts();
    } catch (error) {
      button.disabled = false;
      button.textContent = error?.message || "Tentar novamente";
    }
  });

  menu.querySelector("[data-product-delete-action]")?.addEventListener("click", event => {
    event.stopPropagation();
    showDeleteConfirm(card, menu);
  });
}

function enhanceCard(card) {
  if (!(card instanceof HTMLElement) || card.dataset.productDeleteReady === "true") return;
  const trigger = card.querySelector(".products-card__menu");
  if (!(trigger instanceof HTMLButtonElement)) return;

  const wrapper = document.createElement("div");
  wrapper.className = "products-card__actions";
  trigger.parentNode?.insertBefore(wrapper, trigger);
  wrapper.appendChild(trigger);

  const menu = document.createElement("div");
  menu.className = "products-card__actions-menu";
  menu.dataset.productActionsMenu = "";
  menu.hidden = true;
  wrapper.appendChild(menu);

  trigger.disabled = false;
  trigger.setAttribute("aria-haspopup", "menu");
  trigger.setAttribute("aria-expanded", "false");
  trigger.addEventListener("click", event => {
    event.stopPropagation();
    const opening = menu.hidden;
    closeAllMenus(opening ? menu : null);
    if (opening) populateMenu(card, menu);
    menu.hidden = !opening;
    trigger.setAttribute("aria-expanded", String(opening));
  });

  card.dataset.productDeleteReady = "true";
}

function enhanceProducts() {
  document.querySelectorAll(".products-card").forEach(enhanceCard);
}

const observer = new MutationObserver(enhanceProducts);
observer.observe(document.documentElement, { childList: true, subtree: true });

document.addEventListener("click", () => closeAllMenus());
document.addEventListener("keydown", event => {
  if (event.key === "Escape") closeAllMenus();
});

enhanceProducts();
