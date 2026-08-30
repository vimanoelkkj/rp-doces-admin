(() => {
  const style = document.createElement("style");
  style.textContent = `
    .rp-card-visual { position: relative; overflow: hidden; }
    .rp-card-product-image { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; z-index: 0; }
    .rp-card-badges { position: relative; z-index: 2; }
    .rp-card-visual .flavor-emoji[hidden] { display: none !important; }
    #rpProductDetailEmoji:has(.rp-detail-product-image) { display: block; overflow: hidden; border-radius: 16px; }
    .rp-detail-product-image { width: 100%; height: 100%; min-height: 120px; object-fit: cover; display: block; }
  `;
  document.head.appendChild(style);

  function imageForProduct(product) {
    return product?.image_url || (product?.image_key ? `/api/images/${product.image_key}` : "");
  }

  function productById(id) {
    const products = Array.isArray(window.RP_PRODUTOS) ? window.RP_PRODUTOS : [];
    return products.find(item => Number(item.id) === Number(id));
  }

  function decorateCard(card) {
    if (!(card instanceof HTMLElement)) return;
    const product = productById(card.dataset.productId);
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

  function decorateDetail() {
    const overlay = document.getElementById("rpProductDetailOverlay");
    if (!overlay?.classList.contains("open")) return;
    const title = document.getElementById("rpProductDetailTitle")?.textContent?.trim();
    const product = (window.RP_PRODUTOS || []).find(item => item.nome === title);
    const src = imageForProduct(product);
    if (!src) return;
    const host = document.getElementById("rpProductDetailEmoji");
    if (!host) return;
    host.innerHTML = `<img class="rp-detail-product-image" src="${src}" alt="${String(product.nome || "Foto do produto").replaceAll('"', "&quot;")}" />`;
  }

  function decorateAll() {
    document.querySelectorAll(".flavor-card[data-product-id]").forEach(decorateCard);
    decorateDetail();
  }

  const observer = new MutationObserver(records => {
    for (const record of records) {
      if (record.type === "attributes" && record.target.id === "rpProductDetailOverlay") {
        queueMicrotask(decorateDetail);
      }
      for (const node of record.addedNodes || []) {
        if (!(node instanceof Element)) continue;
        if (node.matches?.(".flavor-card[data-product-id]")) decorateCard(node);
        node.querySelectorAll?.(".flavor-card[data-product-id]").forEach(decorateCard);
      }
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class"]
  });
  addEventListener("rp-menu-ready", decorateAll);
  decorateAll();
})();
