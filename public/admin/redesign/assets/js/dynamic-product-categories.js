import { adminApi } from "./api.js";

let cachedCategories = null;
let loadingCategories = null;

async function loadCategories(force = false) {
  if (!force && cachedCategories) return cachedCategories;
  if (!force && loadingCategories) return loadingCategories;

  loadingCategories = adminApi
    .categories()
    .then(payload => {
      cachedCategories = Array.isArray(payload?.categorias)
        ? payload.categorias.filter(category => Number(category.ativo) === 1)
        : [];
      return cachedCategories;
    })
    .finally(() => {
      loadingCategories = null;
    });

  return loadingCategories;
}

async function populateCategorySelect(select, force = false) {
  if (!(select instanceof HTMLSelectElement)) return;
  if (!force && select.dataset.dynamicCategories === "true") return;

  const currentValue = select.value;
  const categories = await loadCategories(force);
  if (!categories.length) return;

  const replacement = select.cloneNode(false);
  replacement.removeAttribute("data-custom-category");
  replacement.dataset.dynamicCategories = "true";

  categories.forEach(category => {
    const option = document.createElement("option");
    option.value = category.id;
    option.textContent = category.nome;
    replacement.append(option);
  });

  replacement.value = categories.some(category => category.id === currentValue)
    ? currentValue
    : categories[0].id;

  select.closest(".category-select")?.remove();
  select.replaceWith(replacement);
  replacement.dispatchEvent(new Event("change", { bubbles: true }));
}

function populateAll(root = document, force = false) {
  root.querySelectorAll?.('select[name="categoria"]').forEach(select => {
    populateCategorySelect(select, force).catch(error => {
      console.warn("R&P Admin: não foi possível carregar categorias do produto.", error);
    });
  });
}

populateAll();

const observer = new MutationObserver(records => {
  for (const record of records) {
    for (const node of record.addedNodes) {
      if (!(node instanceof Element)) continue;
      if (node.matches?.('select[name="categoria"]')) populateCategorySelect(node);
      populateAll(node);
    }
  }
});
observer.observe(document.body, { childList: true, subtree: true });

document.addEventListener("rp-categories-changed", () => {
  cachedCategories = null;
  populateAll(document, true);
});
