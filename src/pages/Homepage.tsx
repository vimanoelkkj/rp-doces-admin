import Header from "../components/Header";
import { useCallback, useEffect, useRef } from "react";
import { useLocation, useNavigate, useNavigationType } from "react-router-dom";
import Footer from "../components/Footer";
import { useScrollReveal } from "../hooks/useScrollReveal";
import { useCatalogProducts } from "../hooks/useCatalogProducts";
import { useStoreConfig } from "../hooks/useStoreConfig";
import { INSTAGRAM_WEB_URL, openInstagram } from "../lib/instagram";
import BackToTopButton from "../components/BackToTopButton";
import ContactSection from "../components/ContactSection";
import HomeWave from "../components/HomeWave";
import ProcessSection from "../components/ProcessSection";
import TrustCards from "../components/TrustCards";
import UltimoPedidoLink from "../components/UltimoPedidoLink";
import "./Homepage.css";

export default function Homepage() {
  const location = useLocation();
  const navigate = useNavigate();
  const navigationType = useNavigationType();
  const scrollContainerRef = useRef<HTMLElement>(null);
  const { products } = useCatalogProducts();
  const storeConfig = useStoreConfig();
  const galleryProducts = products.filter(product => product.image).slice(0, 5);
  const storyRef = useScrollReveal<HTMLElement>();
  const instaRef = useScrollReveal<HTMLElement>();

  const scrollToStory = useCallback(() => {
    const scroller = scrollContainerRef.current;
    const story = storyRef.current;
    if (!scroller || !story) return;
    const mobile = window.matchMedia("(max-width: 768px)").matches;
    const wave = scroller.parentElement?.querySelector(".wave-container");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // On mobile, keep the Hero behind the opaque fade edge; the photo enters its gradient.
    const clearance =
      mobile && wave
        ? wave.getBoundingClientRect().height - 20
        : parseFloat(getComputedStyle(scroller).scrollPaddingTop);
    // Layout offsets avoid the reveal transform shifting the final destination.
    scroller.scrollTo({
      top: story.offsetTop - clearance,
      behavior: reducedMotion ? "instant" : "smooth"
    });
  }, [storyRef]);

  useEffect(() => {
    if (
      navigationType === "POP" &&
      location.hash === "#sobre" &&
      window.history.state?.homeStoryCta === true
    ) {
      scrollToStory();
    }
  }, [location.hash, navigationType, scrollToStory]);

  const handleLearnMore = () => {
    scrollToStory();
    if (window.location.hash === "#sobre") return;
    navigate(
      { pathname: location.pathname, search: location.search, hash: "#sobre" },
      { state: location.state }
    );
    // Tag only this new entry, preserving the Router's usr, key and idx metadata.
    window.history.replaceState({ ...window.history.state, homeStoryCta: true }, "");
  };

  return (
    <div className="homepage">
      {/* ===== WAVE DECORATION ===== */}
      <HomeWave />
      <Header variant="storefront" />

      <main className="homepage-content" ref={scrollContainerRef}>
        {/* ===== HERO ===== */}
        <section className="hero">
          <div className="hero-left">
            <div className="hero-eyebrow">
              <span className="hero-tag">Artesanal &amp; Exclusivo</span>
              <span className="hero-location">Campinas, SP</span>
            </div>

            <h1 className="hero-title">Um docinho enquanto você se cuida</h1>

            <p className="hero-description">
              Unimos o aconchego da alta confeitaria artesanal com o seu momento de autocuidado.
              Saboreie nossos famosos bolos no pote bem recheados e mini pudins cremosos diretamente
              no aconchegante salão {storeConfig.localName}, no Cambuí.
            </p>

            <div className="hero-actions">
              <button type="button" className="btn-primary hero-cta" onClick={handleLearnMore}>
                Saiba mais <span className="arrow-bounce">&nbsp;↓</span>
              </button>
              <UltimoPedidoLink />
            </div>

            <TrustCards />
          </div>

          <div className="hero-right">
            <div className="hero-ellipse" aria-hidden="true" />
            <img
              className="hero-cake-image"
              src="/images/hero-cake.webp"
              alt="Bolo no pote artesanal R&P Doces"
            />
            <div className="floating-badge">
              <span className="floating-label">Onde Estamos</span>
              <span className="floating-place">{storeConfig.localName}</span>
              <span className="floating-city">Cambuí, Campinas</span>
            </div>
          </div>
        </section>

        {/* ===== NOSSA HISTÓRIA ===== */}
        <section className="story-section scroll-reveal" id="sobre" ref={storyRef}>
          <div className="story-inner">
            <div className="story-image-wrapper">
              <img
                src="/images/story-image.webp"
                alt="Bolo artesanal R&P Doces"
                className="story-image"
              />
            </div>

            <div className="story-content">
              <div className="story-heading-group">
                <span className="section-tag">Uma Pausa Doce no Seu Dia</span>
                <h2>A união perfeita entre beleza, relaxamento e sabor</h2>
              </div>

              <p className="story-text">
                A R&amp;P Doces nasceu com um propósito muito especial: fazer parte da experiência
                da Temponi Concept. A ideia era simples, unir ao momento de cuidado e beleza uma
                pausa doce, daquelas que fazem a gente desacelerar por alguns minutos. Foi assim que
                bolos no pote e mini pudins passaram a dividir espaço com conversas, cuidados e
                momentos de relaxamento.
              </p>

              <blockquote className="story-quote">
                <p>
                  "Não é apenas sobre comer um doce, é sobre saborear uma pausa de carinho no seu
                  dia."
                </p>
              </blockquote>
            </div>
          </div>
        </section>

        {/* Process Section */}
        <ProcessSection />

        {/* ===== INSTAGRAM ===== */}
        <section className="instagram-section scroll-reveal" ref={instaRef}>
          <div className="instagram-header">
            <div className="instagram-title-group">
              <span className="section-tag">Acompanhe-nos</span>
              <h2>Suspiros diários no @rp.doces_</h2>
            </div>
            <a
              href={INSTAGRAM_WEB_URL}
              className="btn-instagram"
              target="_blank"
              rel="noopener noreferrer"
              onClick={openInstagram}
            >
              Seguir no Instagram
            </a>
          </div>

          <div className="instagram-gallery">
            {galleryProducts.map(product => (
              <img key={product.id} src={product.image} alt={product.name} loading="lazy" />
            ))}
          </div>
        </section>

        {/* ===== CONTATO / ONDE ENCONTRAR ===== */}
        <ContactSection storeConfig={storeConfig} />

        <Footer />
      </main>
      <BackToTopButton scrollerRef={scrollContainerRef} />
    </div>
  );
}
