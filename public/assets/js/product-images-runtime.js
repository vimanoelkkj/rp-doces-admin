(() => {
  function imageForProduct(product) {
    return product?.image_url || (product?.image_key ? `/api/images/${product.image_key}` : "");
  }

  function decorateCard(card) {
    if (!(card instanceof HTMLElement)) return;
    const id = Number(card.dataset.productId || 0);
    if (!id) return;
    const products = Array.isArray(window.RP_PRODUTOS) ? window.RP_PRODUTOS : [];
    const product = products.find(item => Number(item.id) === id);
    const src = imageForProduct(product);
    if (!src) return;

    const visual = card.querySelector(".rp-card-visual");
    if (!visual) return;
    let image = visual.querySelector(".rp-card-product-image");
    if (!image) {
      image = document.createElement("img");
      image.className = "rp-card-product-image";
      image.loading = "lazy";
      image.decoding = "async";
      visual.prepend(image);
    }
    image.src = src;
    image.alt = product?.nome || "Foto do produto";
    const emoji = visual.querySelector(".flavor-emoji");
    if (emoji) emoji.hidden = true;
  }

  function decorateAll() {
    document.querySelectorAll(".flavor-card[data-product-id]").forEach(decorateCard);
  }

  const observer = new MutationObserver(records => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches?.(".flavor-card[data-product-id]")) decorateCard(node);
        node.querySelectorAll?.(".flavor-card[data-product-id]").forEach(decorateCard);
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
  addEventListener("rp-menu-ready", decorateAll);
  decorateAll();
})();
