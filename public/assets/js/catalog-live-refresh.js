import { api } from "./api.js";
import { state, syncCartWithProducts, notify } from "./state.js";
import { storefrontProducts } from "./utils/product-filter.js";
import { sortProducts } from "./utils/product-sort.js";
import { catalogProducts } from "./utils/catalog-response.js";

const REFRESH_INTERVAL_MS = 8000;
let refreshInFlight = false;
let timer = null;

function normalizedProducts(payload) {
  return sortProducts(storefrontProducts(catalogProducts(payload)));
}

function catalogSignature(products = []) {
  return JSON.stringify(
    products.map(product => ({
      id: product.id,
      nome: product.nome,
      categoria: product.categoria,
      categoria_nome: product.categoria_nome,
      categoria_ordem: product.categoria_ordem,
      descricao: product.descricao,
      preco_centavos: product.preco_centavos,
      preco_original_centavos: product.preco_original_centavos,
      promocao_vigente: product.promocao_vigente,
      disponivel: product.disponivel,
      destaque: product.destaque,
      estoque: product.estoque,
      estoque_reservado: product.estoque_reservado,
      emoji: product.emoji,
      image_key: product.image_key,
      image_url: product.image_url
    }))
  );
}

async function refreshCatalogSilently() {
  if (refreshInFlight || document.visibilityState === "hidden") return;
  refreshInFlight = true;

  try {
    const nextProducts = normalizedProducts(await api.getProducts());
    if (catalogSignature(nextProducts) === catalogSignature(state.products)) return;

    state.products = nextProducts;
    state.productsStatus = "ready";
    syncCartWithProducts();
    notify();
  } catch (error) {
    console.warn("R&P: atualização silenciosa do cardápio falhou.", error);
  } finally {
    refreshInFlight = false;
  }
}

function scheduleRefresh() {
  clearInterval(timer);
  timer = setInterval(refreshCatalogSilently, REFRESH_INTERVAL_MS);
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") refreshCatalogSilently();
});

window.addEventListener("focus", refreshCatalogSilently);
window.addEventListener("online", refreshCatalogSilently);

scheduleRefresh();
