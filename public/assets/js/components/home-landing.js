import { renderSiteHeader } from "./site-header.js";
import { renderProductCard } from "./product-card.js";
import { storefrontProducts } from "../utils/product-filter.js";
import { sortProducts } from "../utils/product-sort.js";

function highlights(products = [], cart = new Map()) {
  const list = sortProducts(storefrontProducts(products)).slice(0, 5);
  if (!list.length) {
    return `<div class="rp-figma-home__empty">Carregando os destaques do cardápio…</div>`;
  }

  return `<div class="rp-figma-home__products">${list
    .map(product => renderProductCard(product, Number(cart.get(String(product.id))) || 0))
    .join("")}</div>`;
}

function benefit(icon, title, subtitle) {
  return `<div class="rp-figma-benefit"><span class="rp-figma-benefit__icon" aria-hidden="true">${icon}</span><span><strong>${title}</strong><small>${subtitle}</small></span></div>`;
}

export function renderHomeLanding({ products = [], cart = new Map(), summary = {} } = {}) {
  return `<section class="rp-home rp-figma-home" id="topo" data-home-landing>
    ${renderSiteHeader(summary)}

    <section class="rp-figma-hero" aria-labelledby="rp-figma-hero-title">
      <img class="rp-figma-hero__image" src="/assets/images/rp-image-01.webp" alt="" decoding="async" />
      <div class="rp-figma-hero__shade" aria-hidden="true"></div>
      <div class="rp-figma-hero__copy">
        <span class="rp-figma-hero__tag">Doce como a vida deve ser. ♡</span>
        <h1 id="rp-figma-hero-title">Pequenos <em>potes</em>,<br />grandes momentos.</h1>
        <p>Receitas artesanais, feitas com ingredientes de verdade e muito carinho para adoçar a sua rotina.</p>
      </div>
    </section>

    <section class="rp-figma-benefits" aria-label="Diferenciais R&P Doces">
      ${benefit("⌁", "Ingredientes", "de verdade")}
      ${benefit("✦", "Produção", "artesanal")}
      ${benefit("↗", "Entrega", "com cuidado")}
      ${benefit("♡", "Mais doces", "no seu dia")}
    </section>

    <section class="rp-figma-section rp-figma-highlights" aria-labelledby="rp-figma-highlights-title">
      <div class="rp-figma-section__head">
        <h2 id="rp-figma-highlights-title">Destaques do cardápio</h2>
        <button type="button" data-show-catalog>Ver todos <span aria-hidden="true">›</span></button>
      </div>
      ${highlights(products, cart)}
    </section>

    <section class="rp-figma-promos" aria-label="Combos e presentes">
      <article class="rp-figma-promo rp-figma-promo--combo">
        <img src="/assets/images/rp-image-05.webp" alt="" loading="lazy" decoding="async" />
        <div class="rp-figma-promo__shade" aria-hidden="true"></div>
        <div class="rp-figma-promo__copy">
          <h2>Combos especiais</h2>
          <p>Mais sabor, mais momentos. Monte seu combo favorito e aproveite para compartilhar, ou não.</p>
          <button type="button" data-show-catalog>Ver combos <span aria-hidden="true">→</span></button>
        </div>
      </article>

      <article class="rp-figma-promo rp-figma-promo--gift">
        <img src="/assets/images/rp-image-06.webp" alt="" loading="lazy" decoding="async" />
        <div class="rp-figma-promo__shade" aria-hidden="true"></div>
        <div class="rp-figma-promo__copy">
          <h2>Presentes que adoçam</h2>
          <p>Surpreenda alguém especial com um doce inesquecível.</p>
          <button type="button" data-show-catalog>Ver presentes →</button>
        </div>
      </article>
    </section>

    <section class="rp-figma-about" id="sobre" aria-labelledby="rp-figma-about-title">
      <div class="rp-figma-about__copy">
        <span>Nossa história</span>
        <h2 id="rp-figma-about-title">Doce de verdade,<br /><em>feito de perto</em></h2>
        <p>A R&amp;P Doces está começando sua história dentro da Temponi Concept, com bolos no pote e mini pudins feitos à mão e em pequenas quantidades.</p>
        <p>Um projeto pequeno no tamanho, mas enorme no cuidado de cada colherada.</p>
      </div>
      <div class="rp-figma-about__media">
        <img src="/assets/images/rp-image-07.webp" alt="R&P Doces" loading="lazy" decoding="async" />
        <div class="rp-figma-about__badge"><strong>100%</strong><span>artesanal &amp;<br />sem conservantes</span></div>
      </div>
    </section>

    <footer class="rp-figma-footer" id="contato">
      <div class="rp-figma-footer__brand"><strong>R&amp;P</strong> Doces</div>
      <p>Pequenos potes, grandes momentos.</p>
      <nav aria-label="Links do rodapé">
        <button type="button" data-home-top>Início</button>
        <button type="button" data-show-catalog>Cardápio</button>
        <button type="button" data-home-section="sobre">Sobre nós</button>
        <a href="https://wa.me/5533991285907" target="_blank" rel="noopener noreferrer">WhatsApp</a>
      </nav>
    </footer>
  </section>`;
}
