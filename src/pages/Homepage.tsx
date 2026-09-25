import Header from "../components/Header";
import { useState, useEffect, useRef, type MouseEvent } from "react";
import Footer from "../components/Footer";
import { Link } from "react-router-dom";
import { useScrollReveal } from "../hooks/useScrollReveal";
import { useCatalogProducts } from "../hooks/useCatalogProducts";
import {
  DEFAULT_STORE_CONFIG,
  deliveryStatusLabel,
  fetchStoreConfig,
  formatStoreSchedule,
  formatStoreWhatsapp,
  storeWhatsappHref,
} from "../api/storeConfig";
import { createPortal } from "react-dom";
import { motion, useReducedMotion } from "motion/react";
import "./Homepage.css";

const PRIMARY_A =
  "M0 0V324.8C120.0 433.1 253.3 460.1 400.0 406.0C546.7 351.9 680.0 340.3 800.0 371.2C920.0 402.1 1053.3 394.4 1200.0 348.0C1320.0 309.3 1400.0 270.7 1440 232.0V0H0Z";

const PRIMARY_B =
  "M0 0V332.8C134.0 421.1 271.0 448.1 416.0 396.0C562.0 362.9 697.0 354.3 817.0 383.2C938.0 391.1 1070.0 382.4 1214.0 340.0C1332.0 319.3 1410.0 280.7 1440 240.0V0H0Z";

const PRIMARY_C =
  "M0 0V318.8C108.0 438.1 238.0 466.1 386.0 413.0C532.0 342.9 664.0 329.3 784.0 360.2C904.0 412.1 1038.0 403.4 1186.0 355.0C1308.0 301.3 1390.0 262.7 1440 226.0V0H0Z";

const SECONDARY_A =
  "M0 0V335.8C132.0 445.1 268.0 469.1 412.0 395.0C536.0 339.9 668.0 351.3 788.0 384.2C934.0 413.1 1066.0 383.4 1188.0 335.0C1310.0 320.3 1392.0 283.7 1440 241.0V0H0Z";

const SECONDARY_B =
  "M0 0V329.8C118.0 437.1 252.0 461.1 398.0 403.0C550.0 347.9 684.0 360.3 804.0 392.2C918.0 404.1 1050.0 374.4 1202.0 328.0C1322.0 327.3 1402.0 290.7 1440 247.0V0H0Z";

const SECONDARY_C =
  "M0 0V341.8C146.0 451.1 282.0 475.1 426.0 388.0C522.0 332.9 654.0 343.3 774.0 376.2C948.0 421.1 1080.0 391.4 1174.0 341.0C1298.0 314.3 1382.0 276.7 1440 236.0V0H0Z";


const INSTAGRAM_WEB_URL = "https://www.instagram.com/rp.doces_/";
const INSTAGRAM_IOS_URL = "instagram://user?username=rp.doces_";
const INSTAGRAM_ANDROID_URL =
  "intent://instagram.com/_u/rp.doces_/#Intent;package=com.instagram.android;scheme=https;S.browser_fallback_url=https%3A%2F%2Fwww.instagram.com%2Frp.doces_%2F;end";

export default function Homepage() {
  const shouldReduceMotion = useReducedMotion();
  const scrollContainerRef = useRef<HTMLElement>(null);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [storeConfig, setStoreConfig] = useState(DEFAULT_STORE_CONFIG);
  const { products } = useCatalogProducts();
  const galleryProducts = products.filter((product) => product.image).slice(0, 5);
  const storeSchedule = formatStoreSchedule(
    storeConfig.days,
    storeConfig.openTime,
    storeConfig.closeTime,
  );
  const storeDelivery = deliveryStatusLabel(storeConfig.deliveryStatus);
  const storeWhatsapp = formatStoreWhatsapp(storeConfig.whatsapp);
  const storeWhatsappUrl = storeWhatsappHref(
    storeConfig.whatsapp,
    storeConfig.defaultMessage,
  );

  useEffect(() => {
    let active = true;
    void fetchStoreConfig()
      .then((config) => {
        if (active) setStoreConfig(config);
      })
      .catch(() => {
        // A home continua utilizável com os valores padrão se a configuração
        // pública estiver temporariamente indisponível.
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const scroller = scrollContainerRef.current;
    if (!scroller) return;

    const handleScroll = () => {
      setShowBackToTop(scroller.scrollTop > 1);
    };

    handleScroll();
    scroller.addEventListener("scroll", handleScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", handleScroll);
  }, []);

  const scrollToTop = () => {
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  };

  const openInstagram = (event: MouseEvent<HTMLAnchorElement>) => {
    const userAgent = navigator.userAgent;

    if (/Android/i.test(userAgent)) {
      event.preventDefault();
      window.location.href = INSTAGRAM_ANDROID_URL;
      return;
    }

    if (/iPhone|iPad|iPod/i.test(userAgent)) {
      event.preventDefault();

      const fallbackTimer = window.setTimeout(() => {
        window.location.href = INSTAGRAM_WEB_URL;
      }, 1200);

      const stopFallback = () => {
        if (!document.hidden) return;
        window.clearTimeout(fallbackTimer);
        document.removeEventListener("visibilitychange", stopFallback);
      };

      document.addEventListener("visibilitychange", stopFallback);
      window.location.href = INSTAGRAM_IOS_URL;
    }
  };
  const storyRef = useScrollReveal<HTMLElement>();
  const processHeaderRef = useScrollReveal<HTMLDivElement>();
  const step1Ref = useScrollReveal<HTMLElement>();
  const step2Ref = useScrollReveal<HTMLElement>();
  const step3Ref = useScrollReveal<HTMLElement>();
  const processCtaRef = useScrollReveal<HTMLDivElement>();
  const instaRef = useScrollReveal<HTMLElement>();
  const contactRef = useScrollReveal<HTMLElement>();

  return (
    <div className="homepage">
      {/* ===== WAVE DECORATION ===== */}
      <div className="wave-container" aria-hidden="true">
        <svg
          viewBox="0 0 1440 434"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          preserveAspectRatio="none"
        >
<motion.path
            className="wave-secondary"
            d={SECONDARY_A}
            animate={
              shouldReduceMotion
                ? undefined
                : { d: [SECONDARY_A, SECONDARY_B, SECONDARY_C] }
            }
            transition={
              shouldReduceMotion
                ? undefined
                : {
                    duration: 12,
                    repeat: Infinity,
                    repeatType: "mirror",
                    ease: "easeInOut",
                  }
            }
          />
          <motion.path
            className="wave-primary"
            d={PRIMARY_A}
            animate={
              shouldReduceMotion
                ? undefined
                : { d: [PRIMARY_A, PRIMARY_B, PRIMARY_C] }
            }
            transition={
              shouldReduceMotion
                ? undefined
                : {
                    duration: 9,
                    repeat: Infinity,
                    repeatType: "mirror",
                    ease: "easeInOut",
                  }
            }
          />
        </svg>
      </div>
      <Header />

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
            Unimos o aconchego da alta confeitaria artesanal com o seu momento
            de autocuidado. Saboreie nossos famosos bolos no pote bem recheados
            e mini pudins cremosos diretamente no aconchegante salão{" "}
            {storeConfig.localName}, no Cambuí.
          </p>

          <a href="#sobre" className="btn-primary hero-cta">
            Saiba mais <span className="arrow-bounce">&nbsp;↓</span>
          </a>

          <div className="trust-cards">
            {/* Card 1 — Ingredientes Premium */}
            <div className="trust-card">
              <div className="trust-card-icon">
                <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
                  {/* Morango */}
                  <g>
                    <animateTransform
                      attributeName="transform"
                      type="translate"
                      values="0,0; 0,-3; 0,0"
                      dur="1.5s"
                      repeatCount="indefinite"
                    />
                    <path
                      d="M16 26C16 23 19 20 22 21.5C22 21.5 24 19 27 20.5C30 22 29 26 29 26"
                      fill="#634738"
                    />
                    <path
                      d="M16 27C16 27 14.5 38 22.5 42C30.5 38 29 27 29 27C29 27 26 25.5 22.5 25.5C19 25.5 16 27 16 27Z"
                      fill="#D38B80"
                    />
                    <circle cx="19.5" cy="31" r="1" fill="#FAF6F0" />
                    <circle cx="25.5" cy="31" r="1" fill="#FAF6F0" />
                    <circle cx="22.5" cy="34.5" r="1" fill="#FAF6F0" />
                    <circle cx="19" cy="35" r="0.9" fill="#FAF6F0" />
                    <circle cx="26" cy="35" r="0.9" fill="#FAF6F0" />
                    <circle cx="21" cy="38" r="0.8" fill="#FAF6F0" />
                    <circle cx="24" cy="38" r="0.8" fill="#FAF6F0" />
                  </g>
                  {/* Chocolate */}
                  <g>
                    <animateTransform
                      attributeName="transform"
                      type="translate"
                      values="0,0; 0,-4; 0,0"
                      dur="1.8s"
                      repeatCount="indefinite"
                      begin="0.4s"
                    />
                    <rect
                      x="36"
                      y="26"
                      width="14"
                      height="18"
                      rx="2"
                      fill="#634738"
                    />
                    <line
                      x1="43"
                      y1="26"
                      x2="43"
                      y2="44"
                      stroke="#4e3529"
                      strokeWidth="1"
                    />
                    <line
                      x1="36"
                      y1="35"
                      x2="50"
                      y2="35"
                      stroke="#4e3529"
                      strokeWidth="1"
                    />
                    <rect
                      x="45"
                      y="20"
                      width="7"
                      height="7"
                      rx="1.2"
                      fill="#8C7A76"
                      transform="rotate(-12 48.5 23.5)"
                    />
                  </g>
                </svg>
              </div>
              <strong className="trust-card-title">Ingredientes Premium</strong>
              <span className="trust-card-desc">
                Leite moça e frutas frescas
              </span>
            </div>

            {/* Card 2 — Feito com Carinho */}
            <div className="trust-card">
              <div className="trust-card-icon">
                <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
                  {/* Coração esquerda */}
                  <g>
                    <animateTransform
                      attributeName="transform"
                      type="translate"
                      values="0,0; -1,-10; -2,-20"
                      dur="2s"
                      repeatCount="indefinite"
                    />
                    <animate
                      attributeName="opacity"
                      values="1;1;0"
                      dur="2s"
                      repeatCount="indefinite"
                    />
                    <path
                      d="M18 40C18 40 11 33 11 29C11 26 14 23.5 17 25C17.8 25.4 18 26.5 18 26.5C18 26.5 18.2 25.4 19 25C22 23.5 25 26 25 29C25 33 18 40 18 40Z"
                      fill="#D38B80"
                    />
                  </g>
                  {/* Coração centro (maior) */}
                  <g>
                    <animateTransform
                      attributeName="transform"
                      type="translate"
                      values="0,0; 0,-12; 0,-24"
                      dur="2.3s"
                      repeatCount="indefinite"
                      begin="0.5s"
                    />
                    <animate
                      attributeName="opacity"
                      values="1;1;0"
                      dur="2.3s"
                      repeatCount="indefinite"
                      begin="0.5s"
                    />
                    <path
                      d="M32 44C32 44 23 35.5 23 30.5C23 27.5 26 25 29.5 26.5C30.5 27 32 29 32 29C32 29 33.5 27 34.5 26.5C38 25 41 27.5 41 30.5C41 35.5 32 44 32 44Z"
                      fill="#D38B80"
                    />
                  </g>
                  {/* Coração direita (menor) */}
                  <g>
                    <animateTransform
                      attributeName="transform"
                      type="translate"
                      values="0,0; 1,-8; 2,-16"
                      dur="1.8s"
                      repeatCount="indefinite"
                      begin="1s"
                    />
                    <animate
                      attributeName="opacity"
                      values="1;1;0"
                      dur="1.8s"
                      repeatCount="indefinite"
                      begin="1s"
                    />
                    <path
                      d="M48 41C48 41 43 36 43 33C43 31 45 29.5 47 30.5C47.5 30.7 48 31.5 48 31.5C48 31.5 48.5 30.7 49 30.5C51 29.5 53 31 53 33C53 36 48 41 48 41Z"
                      fill="#D38B80"
                    />
                  </g>
                </svg>
              </div>
              <strong className="trust-card-title">Feito com Carinho</strong>
              <span className="trust-card-desc">
                Sempre fresquinho e cremoso
              </span>
            </div>
          </div>
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
      <section
        className="story-section scroll-reveal"
        id="sobre"
        ref={storyRef}
      >
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
              A R&amp;P Doces nasceu com um propósito muito especial: fazer
              parte da experiência da Temponi Concept. A ideia era simples, unir
              ao momento de cuidado e beleza uma pausa doce, daquelas que fazem
              a gente desacelerar por alguns minutos. Foi assim que bolos no
              pote e mini pudins passaram a dividir espaço com conversas,
              cuidados e momentos de relaxamento.
            </p>

            <blockquote className="story-quote">
              <p>
                "Não é apenas sobre comer um doce, é sobre saborear uma pausa de
                carinho no seu dia."
              </p>
            </blockquote>
          </div>
        </div>
      </section>

      {/* Process Section */}
      <section id="cardapio" className="process-section">
        <div className="process-header scroll-reveal" ref={processHeaderRef}>
          <span className="process-label">Como funciona</span>
          <h2 className="process-title">
            Um momento especial entre se cuidar e se deliciar.
          </h2>
        </div>

        <div className="process-journey">
          {/* Etapa 1 — Seu pedido, do seu jeito */}
          <article
            className="journey-step journey-step--1 scroll-reveal"
            ref={step1Ref}
          >
            <div className="journey-step__marker">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <rect
                  x="5"
                  y="2"
                  width="14"
                  height="20"
                  rx="2.5"
                  stroke="var(--store-header-icon-stroke)"
                  strokeWidth="1.8"
                  fill="none"
                />
                <line
                  x1="9"
                  y1="4.5"
                  x2="15"
                  y2="4.5"
                  stroke="var(--store-header-icon-stroke)"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                />
                <circle cx="12" cy="19.5" r="1" fill="var(--store-header-icon-stroke)" />
                <path
                  d="M8 12.5L10.5 15L16 9.5"
                  stroke="var(--store-accent)"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray="12"
                  strokeDashoffset="12"
                >
                  <animate
                    attributeName="stroke-dashoffset"
                    values="12;0;0;12"
                    keyTimes="0;0.3;0.7;1"
                    dur="2.5s"
                    repeatCount="indefinite"
                  />
                </path>
              </svg>
            </div>
            <div className="journey-step__content">
              <h3 className="journey-step__title">Seu pedido, do seu jeito</h3>
              <p className="journey-step__desc">
                Escolha entre nossos sabores disponíveis aqui no site, ou no
                salão
              </p>
            </div>
          </article>

          {/* Etapa 2 — Uma pausa para saborear */}
          <article
            className="journey-step journey-step--2 scroll-reveal"
            ref={step2Ref}
          >
            <div className="journey-step__marker">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                {/* Pote — corpo com fundo arredondado */}
                <path
                  d="M5 8.5C5 8.5 5 18 5.5 19C6 20 7 20.5 12 20.5C17 20.5 18 20 18.5 19C19 18 19 8.5 19 8.5"
                  stroke="var(--store-header-icon-stroke)"
                  strokeWidth="1.6"
                  fill="none"
                  strokeLinecap="round"
                />
                {/* Tampa */}
                <rect x="4" y="7" width="16" height="2" rx="1" fill="var(--store-header-icon-stroke)" />
                {/* Camada 1 — chocolate */}
                <rect
                  x="6"
                  y="16"
                  width="12"
                  height="3"
                  rx="0.5"
                  fill="var(--store-btn-primary-bg)"
                  opacity="0.8"
                />
                {/* Camada 2 — creme */}
                <rect
                  x="6"
                  y="13"
                  width="12"
                  height="3"
                  rx="0.5"
                  fill="var(--store-wave-primary)"
                />
                {/* Camada 3 — morango/rosa */}
                <rect
                  x="6"
                  y="10"
                  width="12"
                  height="3"
                  rx="0.5"
                  fill="var(--store-accent)"
                  opacity="0.85"
                />
                {/* Cobertura chantilly no topo — ondulada */}
                <path
                  d="M7 10C7 10 8 8.5 9.5 9C11 9.5 10.5 8 12 8C13.5 8 13 9.5 14.5 9C16 8.5 17 10 17 10"
                  fill="var(--store-surface)"
                  stroke="var(--store-border)"
                  strokeWidth="0.5"
                />
                {/* Colher animada */}
                <g>
                  <animateTransform
                    attributeName="transform"
                    type="translate"
                    values="0,0; 0,2; 0,2; 0,0"
                    keyTimes="0;0.3;0.6;1"
                    dur="2.5s"
                    repeatCount="indefinite"
                  />
                  <animateTransform
                    attributeName="transform"
                    type="rotate"
                    values="0 15 5; -15 15 5; -15 15 5; 0 15 5"
                    keyTimes="0;0.3;0.6;1"
                    dur="2.5s"
                    repeatCount="indefinite"
                    additive="sum"
                  />
                  {/* Cabo */}
                  <line
                    x1="15"
                    y1="1"
                    x2="15"
                    y2="5.5"
                    stroke="var(--store-header-icon-stroke)"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                  />
                  {/* Cabeça da colher */}
                  <ellipse cx="15" cy="6.5" rx="1.8" ry="1.2" fill="var(--store-header-icon-stroke)" />
                  {/* Reflexo na colher */}
                  <ellipse
                    cx="14.5"
                    cy="6.3"
                    rx="0.6"
                    ry="0.4"
                    fill="var(--store-text-subtle)"
                  />
                </g>
              </svg>
            </div>
            <div className="journey-step__content">
              <h3 className="journey-step__title">Uma pausa para saborear</h3>
              <p className="journey-step__desc">
                Saboreie seu bolo ou pudim enquanto realiza seus procedimentos
                de beleza e autocuidado
              </p>
            </div>
          </article>

          {/* Etapa 3 — Um carinho que acompanha */}
          <article
            className="journey-step journey-step--3 scroll-reveal"
            ref={step3Ref}
          >
            <div className="journey-step__marker">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <g>
                  <animateTransform
                    attributeName="transform"
                    type="rotate"
                    values="0 12 12; 5 12 12; 0 12 12; -5 12 12; 0 12 12"
                    dur="2s"
                    repeatCount="indefinite"
                  />
                  <path
                    d="M12 7V18M12 7C11.5 5.5 10.8 4.5 10 3.8C9.2 3.1 8.2 2.8 7.5 3C6.5 3.3 6 4.2 6 5C6 5.8 6.5 6.5 7 7M12 7C12.5 5.5 13.2 4.5 14 3.8C14.8 3.1 15.8 2.8 16.5 3C17.5 3.3 18 4.2 18 5C18 5.8 17.5 6.5 17 7"
                    stroke="var(--store-accent)"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  />
                  <rect
                    x="5"
                    y="7"
                    width="14"
                    height="4"
                    rx="1"
                    stroke="var(--store-header-icon-stroke)"
                    strokeWidth="1.8"
                    fill="none"
                  />
                  <path
                    d="M6.5 11V18C6.5 19.1 7.4 20 8.5 20H15.5C16.6 20 17.5 19.1 17.5 18V11"
                    stroke="var(--store-header-icon-stroke)"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  />
                </g>
              </svg>
            </div>
            <div className="journey-step__content">
              <h3 className="journey-step__title">Um carinho que acompanha</h3>
              <p className="journey-step__desc">
                Leve bolos para adoçar a familia! Com embalagens seguras e
                prontas para viagem!
              </p>
            </div>
          </article>
        </div>

        <div className="process-cta-wrap scroll-reveal" ref={processCtaRef}>
          <Link to="/cardapio" className="btn-cardapio">
            Ver cardápio
          </Link>
        </div>
      </section>

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
          {galleryProducts.map((product) => (
            <img
              key={product.id}
              src={product.image}
              alt={product.name}
              loading="lazy"
            />
          ))}
        </div>
      </section>

      {/* ===== CONTATO / ONDE ENCONTRAR ===== */}
      <section
        className="contact-section scroll-reveal"
        id="onde-estamos"
        ref={contactRef}
      >
        <div className="contact-header">
          <span className="section-tag">Nosso Espaço</span>
          <h2>Nosso cantinho no Cambuí</h2>
        </div>

        <div className="contact-card">
          <div className="contact-accent-bar" aria-hidden="true" />
          <div className="contact-content">
            <div className="contact-location-header">
              <div className="contact-icon-bg">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="var(--store-header-icon-stroke)"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                  <polyline points="9 22 9 12 15 12 15 22" />
                </svg>
              </div>
              <div>
                <h4>Localização</h4>
                <p className="contact-location-name">{storeConfig.localName}</p>
              </div>
            </div>

            <hr className="contact-divider" />

            <div className="contact-info-grid">
              <div className="contact-info-item">
                <div className="contact-icon-bg">
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="var(--store-header-icon-stroke)"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                    <circle cx="12" cy="10" r="3" />
                  </svg>
                </div>
                <div>
                  <h4>Endereço</h4>
                  {storeConfig.mapsLink ? (
                    <a
                      href={storeConfig.mapsLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: "inherit", textDecoration: "none" }}
                    >
                      <p>{storeConfig.address}</p>
                    </a>
                  ) : (
                    <p>{storeConfig.address}</p>
                  )}
                </div>
              </div>

              <div className="contact-info-item">
                <div className="contact-icon-bg">
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="var(--store-header-icon-stroke)"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                </div>
                <div>
                  <h4>Atendimento</h4>
                  <p>{storeSchedule}</p>
                  <p>{storeDelivery}</p>
                </div>
              </div>

              <div className="contact-info-item">
                <div className="contact-icon-bg">
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="var(--store-header-icon-stroke)"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.362 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.338 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
                  </svg>
                </div>
                <div>
                  <h4>WhatsApp para Encomendas</h4>
                  <p>{storeWhatsapp}</p>
                </div>
              </div>

              <a
                href={INSTAGRAM_WEB_URL}
                className="contact-info-item"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Abrir Instagram da R&P Doces"
                onClick={openInstagram}
                style={{ color: "inherit", textDecoration: "none" }}
              >
                <div className="contact-icon-bg">
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="var(--store-header-icon-stroke)"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
                    <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
                    <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
                  </svg>
                </div>
                <div>
                  <h4>Instagram</h4>
                  <p>@rp.doces_</p>
                </div>
              </a>
            </div>

            <a
              href={storeWhatsappUrl}
              className="btn-whatsapp"
              target="_blank"
              rel="noopener noreferrer"
            >
              Falar pelo WhatsApp
            </a>
          </div>
        </div>
      </section>

      <Footer />
      </main>
      {createPortal(
        <button
          className={`back-to-top ${showBackToTop ? "back-to-top--visible" : ""}`}
          onClick={scrollToTop}
          aria-label="Voltar ao topo"
        >
          ↑
        </button>,
        document.body,
      )}
    </div>
  );
}
