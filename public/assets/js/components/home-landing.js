import { temponiLogoFull } from "../assets/temponi-logo-full.js";
import { renderProductCard } from "./product-card.js";
import { storefrontProducts } from "../utils/product-filter.js";
import { sortProducts } from "../utils/product-sort.js";

const REDESIGN_HERO_IMAGE = "/assets/images/rp-hero-ultrawide-v3.webp";

function cartQuantity(cart, product) {
  return Number(cart?.get?.(String(product.id))) || 0;
}

function homeProducts(products = [], cart = new Map()) {
  const list = sortProducts(storefrontProducts(products)).slice(0, 5);
  if (!list.length) {
    return `<div class="rp-home-catalog__empty">O cardápio está sendo carregado…</div>`;
  }
  return list.map(product => renderProductCard(product, cartQuantity(cart, product))).join("");
}

export function renderHomeLanding(products = [], cart = new Map()) {
  return `<section class="rp-home rp-home--redesign" id="topo" data-home-landing>
    <header class="rp-home-header">
      <button type="button" class="rp-home-header__brand" data-home-top aria-label="Voltar ao início">
        <strong>R&amp;P</strong><span>Doces que fazem bem</span>
      </button>

      <nav class="rp-home-header__nav" aria-label="Seções da página">
        <a href="#cardapio-home">Cardápio</a>
        <a href="#sobre">Sobre</a>
        <a href="#onde-encontrar">Onde estamos</a>
        <a href="#contato">Contato</a>
      </nav>

      <div class="rp-home-header__actions">
        <button type="button" class="rp-home-header__menu rp-home-header__menu--mobile" data-open-menu aria-label="Abrir menu">
          <span aria-hidden="true"></span>
        </button>
        <button type="button" class="rp-home-header__order" data-show-catalog>Fazer pedido</button>
      </div>
    </header>

    <section class="rp-home-hero" aria-labelledby="rp-home-title">
      <div class="rp-home-hero__body">
        <div class="rp-home-hero__copy">
          <span class="rp-home-hero__eyebrow">Bolo no pote e muito mais</span>
          <h1 class="rp-home-hero__title" id="rp-home-title">
            <span>Pequenos potes,</span>
            <em>grandes</em>
            <span>momentos.</span>
          </h1>
          <p class="rp-home-hero__lede">Receitas artesanais, feitas com ingredientes de verdade e muito carinho.</p>
        </div>

        <div class="rp-home-media rp-home-media--hero has-image" role="img" aria-label="Doces R&amp;P em destaque">
          <img data-home-managed-image src="${REDESIGN_HERO_IMAGE}" alt="Bolos no pote e pudim da R&amp;P Doces" decoding="async" fetchpriority="high">
        </div>
      </div>
    </section>

    <section class="rp-home-values-strip" aria-label="Diferenciais R&amp;P">
      <div><span aria-hidden="true">♡</span><p>Ingredientes<br>de verdade</p></div>
      <div><span aria-hidden="true">♨</span><p>Produção<br>artesanal</p></div>
      <div><span aria-hidden="true">☆</span><p>Mais doçura<br>no seu dia</p></div>
      <div><span aria-hidden="true">♧</span><p>Feitos<br>com carinho</p></div>
    </section>

    <section class="rp-home-catalog" id="cardapio-home" aria-labelledby="rp-home-catalog-title">
      <div class="rp-home-catalog__head">
        <div>
          <span class="rp-home-eyebrow">Sabores disponíveis</span>
          <h2 id="rp-home-catalog-title">Nosso cardápio</h2>
        </div>
        <button type="button" data-show-catalog>Ver todos <span aria-hidden="true">→</span></button>
      </div>
      <div class="rp-home-catalog__grid">${homeProducts(products, cart)}</div>
    </section>

    <section class="rp-home-promo-grid" id="contato">
      <article class="rp-home-promo rp-home-promo--dark">
        <div>
          <span class="rp-home-eyebrow">Para dividir. Ou não.</span>
          <h2>Combos especiais</h2>
          <p>Monte seu combo favorito com os sabores disponíveis no dia.</p>
          <button type="button" data-show-catalog>Ver cardápio <span aria-hidden="true">→</span></button>
        </div>
      </article>
      <article class="rp-home-promo rp-home-promo--pink">
        <div>
          <span class="rp-home-eyebrow">Um carinho em forma de doce</span>
          <h2>Presentes que adoçam</h2>
          <p>Uma opção simples e gostosa para surpreender alguém.</p>
          <a href="https://wa.me/5533991285907" target="_blank" rel="noopener noreferrer">Falar com a R&amp;P <span aria-hidden="true">→</span></a>
        </div>
      </article>
    </section>

    <section class="rp-home-section rp-home-section--about" id="sobre">
      <div class="rp-home-section__inner">
        <div class="rp-home-section__copy">
          <span class="rp-home-eyebrow">Nossa história</span>
          <h2 class="rp-home-section__title">Doce de verdade, feito de perto</h2>
          <p class="rp-home-section__text">A R&amp;P Doces está começando sua história dentro da Temponi Concept, com bolos no pote e mini pudins feitos à mão e em pequenas quantidades.</p>
          <p class="rp-home-section__highlight">Um projeto pequeno no tamanho, mas enorme no cuidado de cada colherada.</p>
        </div>
        <div class="rp-home-media rp-home-media--about" role="img" aria-label="R&amp;P Doces na Temponi Concept"><span>foto · r&amp;p doces</span></div>
      </div>
    </section>

    <section class="rp-home-section rp-home-location-section" id="onde-encontrar">
      <div class="rp-home-section__inner rp-home-location-simple">
        <span class="rp-home-eyebrow">Onde encontrar</span>
        <div class="rp-home-location-simple__title">R&amp;P Doces na</div>
        <a class="rp-home-location-simple__logo" href="https://temponiconcept.com.br/" target="_blank" rel="noopener noreferrer" aria-label="Abrir site da Temponi Concept">
          <img src="${temponiLogoFull}" alt="Temponi Concept">
        </a>
        <div class="rp-home-location-simple__place"><span aria-hidden="true">⌖</span><span><strong>Rua Lais Bertoni Pereira, 182 · Sala 07</strong><small>Cambuí · Campinas - SP</small></span></div>
        <a class="rp-home-location-simple__maps" href="https://maps.app.goo.gl/jReUnqehftkYoUNz6" target="_blank" rel="noopener noreferrer">Abrir no Google Maps ↗</a>
      </div>
    </section>

    <footer class="rp-home-footer">
      <div class="rp-home-footer__inner">
        <div><b class="rp-home-footer__name">R&amp;P</b><p>Doces que fazem bem.</p></div>
        <nav aria-label="Navegação"><span class="rp-home-eyebrow">Navegação</span><ul><li><a href="#topo">Início</a></li><li><a href="#cardapio-home">Cardápio</a></li><li><a href="#sobre">Sobre</a></li><li><a href="#onde-encontrar">Onde estamos</a></li></ul></nav>
        <div><span class="rp-home-eyebrow">Contato</span><ul><li><a href="https://wa.me/5533991285907" target="_blank" rel="noopener noreferrer">WhatsApp (33) 99128-5907</a></li><li><a href="/admin/">Painel Admin ↗</a></li></ul></div>
      </div>
    </footer>
  </section>`;
}
