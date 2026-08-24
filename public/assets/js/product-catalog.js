/* ===== Cardápio dinâmico R&P =====
   Se houver produtos no D1, eles substituem os dados locais.
   Se a API estiver vazia/indisponível, o cardápio atual permanece como fallback.
*/
let ultimoSnapshotCardapio = "";
async function carregarCardapioDinamico() {
  try {
    const res = await fetch("/api/products", { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error("Falha ao carregar cardápio");
    const payload = await res.json();
    const snapshotAtual = JSON.stringify(payload);
    if (snapshotAtual === ultimoSnapshotCardapio) return;
    ultimoSnapshotCardapio = snapshotAtual;
    const produtos = Array.isArray(payload.produtos) ? payload.produtos : [];
    window.RP_PRODUTOS = produtos;
    if (typeof window.rpCarrinhoSincronizar === "function") window.rpCarrinhoSincronizar(produtos);

    const boloGrid = document.getElementById("menu-grid-bolo");
    const pudimGrid = document.getElementById("menu-grid-pudim");
    const featuredGrid = document.getElementById("rp-menu-grid-featured");
    const featuredSection = document.getElementById("rpMenuFeatured");
    const emptyState = document.getElementById("rpMenuEmpty");
    const filters = document.getElementById("rpMenuFilters");
    const menuSection = document.getElementById("sabores");
    if (
      !boloGrid ||
      !pudimGrid ||
      !featuredGrid ||
      !featuredSection ||
      !emptyState ||
      !filters ||
      !menuSection
    )
      return;

    if (!produtos.length) {
      boloGrid.classList.remove("is-loading");
      pudimGrid.classList.remove("is-loading");
      boloGrid.innerHTML = '<p class="muted">Nenhum sabor disponível no momento.</p>';
      pudimGrid.innerHTML = '<p class="muted">Nenhum sabor disponível no momento.</p>';
      if (typeof window.rpMarkMenuReady === "function") window.rpMarkMenuReady();
      return;
    }

    const formatar = centavos =>
      (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

    const detailOverlay = document.getElementById("rpProductDetailOverlay");
    const detailTitle = document.getElementById("rpProductDetailTitle");
    const detailEmoji = document.getElementById("rpProductDetailEmoji");
    const detailDescription = document.getElementById("rpProductDetailDescription");
    const detailPrice = document.getElementById("rpProductDetailPrice");
    const detailAdd = document.getElementById("rpProductDetailAdd");
    let detailCard = null;
    function fecharDetalhe() {
      if (!detailOverlay?.classList.contains("open")) return;
      detailOverlay.classList.remove("open");
      detailOverlay.setAttribute("aria-hidden", "true");
      document.body.classList.remove("rp-mobile-menu-open");
      detailCard = null;
    }
    function abrirDetalhe(item) {
      if (innerWidth > 700 || !detailOverlay || !item?._rpProduto) return;
      const produto = item._rpProduto;
      const esgotado = !produto.disponivel || Number(produto.estoque) <= 0;
      detailCard = item;
      detailTitle.textContent = produto.nome || "Produto";
      detailEmoji.textContent = produto.emoji || (produto.categoria === "MINI_PUDIM" ? "🍮" : "🍰");
      detailDescription.textContent = produto.descricao || "Sem descrição.";
      detailPrice.textContent = esgotado ? "Esgotado" : formatar(produto.preco_centavos);
      detailAdd.hidden = esgotado;
      dispatchEvent(new Event("rp-close-mobile-sheets"));
      detailOverlay.classList.add("open");
      detailOverlay.setAttribute("aria-hidden", "false");
      document.body.classList.add("rp-mobile-menu-open");
    }

    function controleCarrinho(produto) {
      const quantidade =
        typeof window.rpCarrinhoQuantidade === "function"
          ? window.rpCarrinhoQuantidade(produto.id)
          : 0;
      const esgotado = !produto.disponivel || Number(produto.estoque) <= 0;
      if (esgotado) return '<span class="rp-card-soldout">Esgotado</span>';
      if (quantidade > 0)
        return `<div class="rp-card-qty"><button type="button" data-card-cart-action="-1" aria-label="Remover uma unidade">−</button><strong>${quantidade}</strong><button type="button" data-card-cart-action="1" aria-label="Adicionar uma unidade" ${quantidade >= Number(produto.estoque) ? "disabled" : ""}>+</button></div>`;
      return '<button class="rp-card-add btn-flavor" type="button" data-card-cart-action="1" aria-label="Adicionar uma unidade ao carrinho"><strong>+</strong><span>Adicionar ao carrinho</span></button>';
    }

    function card(produto, revelar = false) {
      const estoque = Number(produto.estoque) || 0;
      const indisponivel = !produto.disponivel || estoque <= 0;
      const div = document.createElement("div");
      div.className = "flavor-card" + (indisponivel ? " flavor-card--indisponivel" : "");
      if (revelar) div.classList.add("rp-card-reveal");
      div.dataset.productId = produto.id;
      div.dataset.precoCentavos = String(produto.preco_centavos ?? 0);
      div.dataset.precoOriginalCentavos = String(
        produto.preco_original_centavos ?? produto.preco_centavos ?? 0
      );
      div.dataset.promocaoVigente = produto.promocao_vigente ? "true" : "false";
      div.dataset.categoria = produto.categoria || "";
      div.dataset.disponivel = produto.disponivel ? "true" : "false";
      div.dataset.destaque = produto.destaque ? "true" : "false";
      div.dataset.estoque = String(estoque);
      div._rpProduto = produto;
      const badges = [
        produto.promocao_vigente ? '<span class="rp-card-badge">Promo</span>' : "",
        produto.destaque ? '<span class="rp-card-badge">Destaque</span>' : ""
      ].join("");
      const stockBadge =
        estoque === 1
          ? '<span class="rp-card-badge rp-card-badge--stock">Última unidade</span>'
          : "";
      div.innerHTML = `
        <div class="rp-card-visual">
          <div class="rp-card-badges">${badges}</div>
          <div class="flavor-emoji">${rpEscHtml(produto.emoji || (produto.categoria === "MINI_PUDIM" ? "🍮" : "🍰"))}</div>
        </div>
        <div class="rp-card-body">
          <h3>${rpEscHtml(produto.nome)}</h3>
          <p>${rpEscHtml(produto.descricao || "")}</p>
          <div class="rp-card-footer">
            <div class="rp-card-price">${produto.promocao_vigente ? `<s>${formatar(produto.preco_original_centavos)}</s><span>${formatar(produto.preco_centavos)}</span>` : `<span>${formatar(produto.preco_centavos)}</span>`}${stockBadge}</div>
            <div class="rp-card-cart">${controleCarrinho(produto)}</div>
          </div>
        </div>
      `;
      return div;
    }

    window.rpCriarCardProduto = card;
    function atualizarControlesCarrinho() {
      menuSection.querySelectorAll(".flavor-card").forEach(item => {
        if (item._rpProduto) {
          const target = item.querySelector(".rp-card-cart");
          if (target) target.innerHTML = controleCarrinho(item._rpProduto);
        }
      });
    }
    const limiteInicial = 2;
    const secoesExpandidas = new Set();
    let filtroAtual = "TODOS";
    function preencherSecao(grid, lista, chave, botao) {
      const mobile = matchMedia("(max-width:700px)").matches;
      const estado = `${filtroAtual}:${chave}`;
      const expandida = mobile && secoesExpandidas.has(estado);
      const visiveis = mobile && !expandida ? lista.slice(0, limiteInicial) : lista;
      grid.replaceChildren(
        ...visiveis.map((produto, indice) => card(produto, expandida && indice >= limiteInicial))
      );
      if (botao) {
        botao.hidden = !mobile || lista.length <= limiteInicial;
        botao.textContent = expandida ? "Mostrar menos" : "Ver todos ›";
        botao.setAttribute("aria-expanded", String(expandida));
      }
    }
    function renderizar(filtro = "TODOS") {
      filtroAtual = filtro;
      const todosDestaques = produtos.filter(produto => produto.destaque);
      const filtrados = produtos.filter(
        produto =>
          filtro === "TODOS" ||
          produto.categoria === filtro ||
          (filtro === "PROMOCOES" && produto.promocao_vigente)
      );
      const bolos = filtrados.filter(produto => produto.categoria === "BOLO_NO_POTE");
      const pudins = filtrados.filter(produto => produto.categoria === "MINI_PUDIM");
      const destaques = filtro === "TODOS" ? todosDestaques : [];
      const boloCategory = boloGrid.closest("[data-menu-category]"),
        pudimCategory = pudimGrid.closest("[data-menu-category]");
      const featuredButton = featuredSection.querySelector("[data-menu-view]");
      const boloButton = boloCategory.querySelector("[data-menu-view]");
      const pudimButton = pudimCategory.querySelector("[data-menu-view]");
      boloGrid.classList.remove("is-loading");
      preencherSecao(boloGrid, bolos, "BOLO_NO_POTE", boloButton);
      boloCategory.hidden = !bolos.length;
      pudimGrid.classList.remove("is-loading");
      preencherSecao(pudimGrid, pudins, "MINI_PUDIM", pudimButton);
      pudimCategory.hidden = !pudins.length;
      preencherSecao(featuredGrid, destaques, "DESTAQUES", featuredButton);
      featuredSection.hidden = !destaques.length;
      emptyState.hidden = filtrados.length > 0;
      emptyState.textContent =
        filtro === "PROMOCOES"
          ? "Nenhuma promoção disponível no momento."
          : "Nenhum produto disponível neste filtro no momento.";
      filters
        .querySelectorAll("[data-menu-filter]")
        .forEach(button => button.classList.toggle("active", button.dataset.menuFilter === filtro));
    }
    filters.onclick = event => {
      const button = event.target.closest("[data-menu-filter]");
      if (button) renderizar(button.dataset.menuFilter);
    };
    menuSection.querySelectorAll("[data-menu-view]").forEach(
      button =>
        (button.onclick = () => {
          const estado = `${filtroAtual}:${button.dataset.menuView}`;
          if (secoesExpandidas.has(estado)) secoesExpandidas.delete(estado);
          else secoesExpandidas.add(estado);
          renderizar(filtroAtual);
        })
    );
    if (!menuSection.dataset.cartControlsReady) {
      menuSection.dataset.cartControlsReady = "true";
      menuSection.addEventListener("click", event => {
        const action = event.target.closest("[data-card-cart-action]");
        if (action) {
          event.preventDefault();
          event.stopPropagation();
          const item = action.closest(".flavor-card");
          window.rpCarrinhoAlterar?.(item, Number(action.dataset.cardCartAction));
          return;
        }
        const item = event.target.closest(".flavor-card");
        if (item) abrirDetalhe(item);
      });
      addEventListener("rp-cart-updated", atualizarControlesCarrinho);
    }
    if (detailOverlay && !detailOverlay.dataset.ready) {
      detailOverlay.dataset.ready = "true";
      document.getElementById("rpProductDetailClose")?.addEventListener("click", fecharDetalhe);
      detailOverlay.addEventListener("click", event => {
        if (event.target === detailOverlay) fecharDetalhe();
      });
      detailAdd?.addEventListener("click", () => {
        if (detailCard) {
          window.rpCarrinhoAlterar?.(detailCard, 1);
          fecharDetalhe();
        }
      });
      addEventListener("rp-close-mobile-sheets", fecharDetalhe);
      document.addEventListener("keydown", event => {
        if (event.key === "Escape") fecharDetalhe();
      });
    }
    renderizar();
    if (typeof window.rpMarkMenuReady === "function") window.rpMarkMenuReady();
  } catch (err) {
    console.info("Cardápio usando fallback local.");
  }
}
carregarCardapioDinamico();
