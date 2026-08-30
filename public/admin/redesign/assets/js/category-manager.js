import { adminApi } from "./api.js";

function esc(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function categoryCard(category) {
  return `
    <article class="category-manager__card">
      <div class="category-manager__icon" aria-hidden="true">${esc(category.emoji || "🍰")}</div>
      <div class="category-manager__copy">
        <div class="category-manager__title-row">
          <div>
            <strong>${esc(category.nome)}</strong>
            <code>${esc(category.id)}</code>
          </div>
          ${Number(category.sistema) ? '<span class="category-manager__system-badge">Sistema</span>' : '<span class="category-manager__system-badge is-custom">Personalizada</span>'}
        </div>
        <p>${esc(category.descricao || "Categoria personalizada do cardápio.")}</p>
        <div class="category-manager__stats" aria-label="Resumo da categoria ${esc(category.nome)}">
          <span><strong>${Number(category.produtos || 0)}</strong> produtos</span>
          <span><strong>${Number(category.ativos || 0)}</strong> ativos</span>
          <span><strong>${Number(category.arquivados || 0)}</strong> arquivados</span>
        </div>
      </div>
    </article>`;
}

function createDialog(categories) {
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
          <p>Crie categorias e use-as imediatamente nos produtos do cardápio.</p>
        </div>
        <button class="category-manager__close" type="button" data-category-manager-close aria-label="Fechar">×</button>
      </div>

      <form class="category-manager__create" data-category-create-form>
        <div class="category-manager__create-copy">
          <strong>Nova categoria</strong>
          <span>O identificador é criado automaticamente a partir do nome.</span>
        </div>
        <div class="category-manager__create-grid">
          <label><span>Nome</span><input name="nome" maxlength="60" required placeholder="Ex.: Brownies" autocomplete="off" /></label>
          <label class="is-emoji"><span>Emoji</span><input name="emoji" maxlength="16" value="🍰" required /></label>
          <label class="is-wide"><span>Descrição</span><input name="descricao" maxlength="240" placeholder="Ex.: Brownies artesanais da R&P" autocomplete="off" /></label>
        </div>
        <div class="category-manager__create-actions">
          <span data-category-create-message aria-live="polite"></span>
          <button class="products-primary" type="submit" data-category-create-submit>+ Criar categoria</button>
        </div>
      </form>

      <div class="category-manager__list" data-category-list>
        ${categories.map(categoryCard).join("")}
      </div>

      <div class="category-manager__footer">
        <span>${categories.length} ${categories.length === 1 ? "categoria" : "categorias"} no catálogo</span>
        <button class="products-secondary" type="button" data-category-manager-close>Fechar</button>
      </div>
    </section>`;
  return dialog;
}

async function loadCategories() {
  const payload = await adminApi.categories();
  return Array.isArray(payload?.categorias) ? payload.categorias : [];
}

async function openCategoryManager(button) {
  button.disabled = true;
  const previousLabel = button.textContent;
  button.textContent = "Carregando…";

  try {
    let categories = await loadCategories();
    document.querySelector("[data-category-manager]")?.remove();
    const dialog = createDialog(categories);
    document.body.append(dialog);
    document.body.classList.add("category-manager-open");

    const close = () => {
      dialog.remove();
      document.body.classList.remove("category-manager-open");
      document.removeEventListener("keydown", onKeydown);
      button.focus();
    };
    const onKeydown = event => {
      if (event.key === "Escape") close();
    };

    dialog.querySelectorAll("[data-category-manager-close]").forEach(item => {
      item.addEventListener("click", close);
    });
    document.addEventListener("keydown", onKeydown);

    const form = dialog.querySelector("[data-category-create-form]");
    const list = dialog.querySelector("[data-category-list]");
    const message = dialog.querySelector("[data-category-create-message]");
    const submit = dialog.querySelector("[data-category-create-submit]");

    form?.addEventListener("submit", async event => {
      event.preventDefault();
      if (!(form instanceof HTMLFormElement) || !(submit instanceof HTMLButtonElement)) return;
      const data = new FormData(form);
      const nome = String(data.get("nome") || "").trim();
      if (!nome) return;

      submit.disabled = true;
      submit.textContent = "Criando…";
      if (message) message.textContent = "";

      try {
        await adminApi.createCategory({
          nome,
          emoji: String(data.get("emoji") || "🍰").trim(),
          descricao: String(data.get("descricao") || "").trim()
        });
        categories = await loadCategories();
        if (list) list.innerHTML = categories.map(categoryCard).join("");
        const footer = dialog.querySelector(".category-manager__footer > span");
        if (footer)
          footer.textContent = `${categories.length} ${categories.length === 1 ? "categoria" : "categorias"} no catálogo`;
        form.reset();
        const emoji = form.elements.namedItem("emoji");
        if (emoji instanceof HTMLInputElement) emoji.value = "🍰";
        if (message) message.textContent = "Categoria criada.";
        document.dispatchEvent(new CustomEvent("rp-categories-changed"));
      } catch (error) {
        if (message) message.textContent = error?.message || "Não foi possível criar a categoria.";
      } finally {
        submit.disabled = false;
        submit.textContent = "+ Criar categoria";
      }
    });
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
