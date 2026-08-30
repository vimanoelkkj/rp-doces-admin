import { adminApi } from "./api.js";

function centsToInput(cents) {
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number(cents || 0) / 100);
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

function closeAllMenus(except = null) {
  document.querySelectorAll("[data-product-actions-menu]").forEach(menu => {
    if (menu !== except) menu.hidden = true;
  });
}

function refreshProductsView() {
  const close = document.querySelector("[data-product-dialog-close]");
  if (close instanceof HTMLButtonElement) close.click();

  const productsNav = document.querySelector('[data-admin-nav="produtos"]');
  if (productsNav instanceof HTMLButtonElement) productsNav.click();
}

async function getProduct(id) {
  const payload = await adminApi.products();
  const products = Array.isArray(payload?.produtos) ? payload.produtos : [];
  return products.find(product => Number(product.id) === Number(id)) || null;
}

function fillEditForm(form, product) {
  const name = form.elements.namedItem("nome");
  const category = form.elements.namedItem("categoria");
  const stock = form.elements.namedItem("estoque");
  const price = form.elements.namedItem("preco");
  const description = form.elements.namedItem("descricao");
  const active = form.elements.namedItem("ativo");
  const featured = form.elements.namedItem("destaque");

  if (name instanceof HTMLInputElement) name.value = product.nome || "";
  if (category instanceof HTMLSelectElement) {
    category.value = product.categoria || "BOLO_NO_POTE";
    category.dispatchEvent(new Event("change", { bubbles: true }));
  }
  if (stock instanceof HTMLInputElement) {
    stock.value = String(Number(product.estoque || 0));
    stock.dispatchEvent(new Event("input", { bubbles: true }));
  }
  if (price instanceof HTMLInputElement) price.value = centsToInput(product.preco_centavos);
  if (description instanceof HTMLTextAreaElement) description.value = product.descricao || "";
  if (active instanceof HTMLInputElement) active.checked = Number(product.ativo) === 1;
  if (featured instanceof HTMLInputElement) featured.checked = Number(product.destaque) === 1;

  const emojiButton = [...form.querySelectorAll("[data-emoji-option]")].find(
    button => button.dataset.emojiOption === product.emoji
  );
  emojiButton?.click();
}

function setDialogMode(form, product = null) {
  const dialog = form.closest("[data-product-dialog]");
  const title = dialog?.querySelector("#new-product-title");
  const eyebrow = dialog?.querySelector(".products-dialog__eyebrow");
  const subtitle = dialog?.querySelector(".products-dialog__head p");
  const submit = form.querySelector("[data-product-submit]");

  if (product) {
    form.dataset.editProductId = String(product.id);
    form._editingProduct = product;
    if (title) title.textContent = "Editar produto";
    if (eyebrow) eyebrow.textContent = "Catálogo · edição";
    if (subtitle)
      subtitle.textContent = "Atualize os dados do produto sem alterar o histórico dos pedidos.";
    if (submit) submit.textContent = "Salvar alterações";
  } else {
    delete form.dataset.editProductId;
    delete form._editingProduct;
    if (title) title.textContent = "Novo produto";
    if (eyebrow) eyebrow.textContent = "Catálogo";
    if (subtitle) subtitle.textContent = "Cadastre um doce e ele já entra no catálogo administrativo.";
    if (submit) submit.textContent = "Salvar produto";
  }
}

function productPayload(product, overrides = {}) {
  return {
    nome: product.nome,
    categoria: product.categoria,
    descricao: product.descricao || "",
    preco_centavos: Number(product.preco_centavos || 0),
    disponivel: Boolean(Number(product.disponivel)),
    ativo: Boolean(Number(product.ativo)),
    destaque: Boolean(Number(product.destaque)),
    emoji: product.emoji || "🍰",
    estoque: Number(product.estoque || 0),
    promocao_ativa: Boolean(Number(product.promocao_ativa)),
    preco_promocional_centavos: product.preco_promocional_centavos ?? null,
    promocao_inicio: product.promocao_inicio ?? null,
    promocao_fim: product.promocao_fim ?? null,
    ...overrides
  };
}

function enhanceForm(form) {
  if (!(form instanceof HTMLFormElement) || form.dataset.productEditEnhanced === "true") return;
  form.dataset.productEditEnhanced = "true";

  form.addEventListener(
    "submit",
    async event => {
      const id = Number(form.dataset.editProductId || 0);
      if (!id) return;

      event.preventDefault();
      event.stopImmediatePropagation();

      const product = form._editingProduct;
      if (!product) return;

      const data = new FormData(form);
      const price = parseMoneyToCents(data.get("preco"));
      const stock = Number(data.get("estoque"));
      const name = String(data.get("nome") || "").trim();
      const message = form.querySelector("[data-product-form-message]");
      const submit = form.querySelector("[data-product-submit]");

      if (!name || price === null || !Number.isSafeInteger(stock) || stock < 0) {
        if (message) message.textContent = "Confira nome, preço e estoque antes de salvar.";
        return;
      }

      if (submit instanceof HTMLButtonElement) submit.disabled = true;
      if (submit) submit.textContent = "Salvando…";
      if (message) message.textContent = "";

      try {
        await adminApi.updateProduct(
          id,
          productPayload(product, {
            nome: name,
            categoria: String(data.get("categoria") || "BOLO_NO_POTE"),
            descricao: String(data.get("descricao") || "").trim(),
            preco_centavos: price,
            ativo: data.get("ativo") === "on",
            destaque: data.get("destaque") === "on",
            emoji: String(data.get("emoji") || product.emoji || "🍰").trim(),
            estoque: stock
          })
        );

        refreshProductsView();
      } catch (error) {
        if (message)
          message.textContent = error?.message || "Não foi possível salvar as alterações.";
        if (submit instanceof HTMLButtonElement) submit.disabled = false;
        if (submit) submit.textContent = "Salvar alterações";
      }
    },
    true
  );
}

function enhanceCard(card) {
  if (!(card instanceof HTMLElement) || card.dataset.productActionsEnhanced === "true") return;
  const button = card.querySelector(".products-card__menu");
  if (!(button instanceof HTMLButtonElement)) return;

  card.dataset.productActionsEnhanced = "true";
  button.disabled = false;
  button.setAttribute("aria-haspopup", "menu");
  button.setAttribute("aria-expanded", "false");

  const menu = document.createElement("div");
  menu.className = "products-actions-menu";
  menu.dataset.productActionsMenu = "";
  menu.setAttribute("role", "menu");
  menu.hidden = true;
  menu.innerHTML = `
    <button type="button" role="menuitem" data-edit-product>Editar produto</button>
    <button type="button" role="menuitem" data-toggle-product-state>Arquivar produto</button>
  `;
  card.append(menu);

  const stateButton = menu.querySelector("[data-toggle-product-state]");

  button.addEventListener("click", async event => {
    event.stopPropagation();
    const opening = menu.hidden;
    closeAllMenus(opening ? menu : null);
    menu.hidden = !opening;
    button.setAttribute("aria-expanded", String(opening));

    if (opening && stateButton instanceof HTMLButtonElement) {
      const id = Number(card.dataset.productId || 0);
      const product = await getProduct(id);
      if (product) {
        card._productActionProduct = product;
        const archived = Number(product.ativo) === 0;
        stateButton.textContent = archived ? "Reativar produto" : "Arquivar produto";
        stateButton.classList.toggle("is-reactivate", archived);
      }
    }
  });

  menu.querySelector("[data-edit-product]")?.addEventListener("click", async () => {
    menu.hidden = true;
    button.setAttribute("aria-expanded", "false");

    const id = Number(card.dataset.productId || 0);
    const product = card._productActionProduct || (await getProduct(id));
    if (!product) return;

    const newButton = document.querySelector("[data-new-product]");
    if (!(newButton instanceof HTMLButtonElement)) return;
    newButton.click();

    requestAnimationFrame(() => {
      const form = document.querySelector("[data-product-form]");
      if (!(form instanceof HTMLFormElement)) return;
      setDialogMode(form, product);
      fillEditForm(form, product);
    });
  });

  stateButton?.addEventListener("click", async () => {
    menu.hidden = true;
    button.setAttribute("aria-expanded", "false");

    const id = Number(card.dataset.productId || 0);
    const product = card._productActionProduct || (await getProduct(id));
    if (!product) return;

    const archived = Number(product.ativo) === 0;
    if (stateButton instanceof HTMLButtonElement) {
      stateButton.disabled = true;
      stateButton.textContent = archived ? "Reativando…" : "Arquivando…";
    }

    try {
      if (archived) {
        await adminApi.updateProduct(
          id,
          productPayload(product, {
            ativo: true,
            disponivel: true
          })
        );
      } else {
        await adminApi.archiveProduct(id);
      }
      refreshProductsView();
    } catch (error) {
      console.error("R&P Admin: falha ao alterar estado do produto.", error);
      if (stateButton instanceof HTMLButtonElement) {
        stateButton.disabled = false;
        stateButton.textContent = archived ? "Reativar produto" : "Arquivar produto";
      }
    }
  });
}

function enhanceProducts(root = document) {
  root.querySelectorAll?.(".products-card").forEach(enhanceCard);
  root.querySelectorAll?.("[data-product-form]").forEach(enhanceForm);
}

document.addEventListener("click", event => {
  if (!event.target.closest(".products-card__menu, [data-product-actions-menu]")) closeAllMenus();
});

document.addEventListener("click", event => {
  if (event.target.closest("[data-new-product]")) {
    requestAnimationFrame(() => {
      const form = document.querySelector("[data-product-form]");
      if (form instanceof HTMLFormElement) setDialogMode(form, null);
    });
  }
});

enhanceProducts();

const observer = new MutationObserver(records => {
  for (const record of records) {
    for (const node of record.addedNodes) {
      if (!(node instanceof Element)) continue;
      if (node.matches?.(".products-card")) enhanceCard(node);
      if (node.matches?.("[data-product-form]")) enhanceForm(node);
      enhanceProducts(node);
    }
  }
});

observer.observe(document.body, { childList: true, subtree: true });
