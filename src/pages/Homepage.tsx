import Header from "../components/Header";
import { useState, useEffect } from "react";
import Footer from "../components/Footer";
import { Link } from "react-router-dom";
import { useScrollReveal } from "../hooks/useScrollReveal";
import { useCatalogProducts } from "../hooks/useCatalogProducts";
import { createPortal } from "react-dom";
import "./Homepage.css";

export default function Homepage() {
  const [showBackToTop, setShowBackToTop] = useState(false);
  const { products } = useCatalogProducts();
  const galleryProducts = products.filter((product) => product.image).slice(0, 5);

  useEffect(() => {
    const handleScroll = () => {
      setShowBackToTop(window.scrollY > 1);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const storyRef = useScrollReveal<HTMLElement>();
  const processRef = useScrollReveal<HTMLElement>();
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
          <path
            d="M0 0V324.8C120 433.067 253.333 460.133 400 406C546.667 351.867 680 340.267 800 371.2C920 402.133 1053.33 394.4 1200 348C1320 309.333 1400 270.667 1440 232V0H0Z"
            fill="#EDDCC6"
          />
        </svg>
      </div>

      <Header />

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
            e mini pudins cremosos diretamente no aconchegante salão Temponi
            Concept, no Cambuí.
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
            src="/images/hero-cake.png"
            alt="Bolo no pote artesanal R&P Doces"
          />
          <div className="floating-badge">
            <span className="floating-label">Onde Estamos</span>
            <span className="floating-place">Temponi Concept</span>
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
              src="/images/story-image.png"
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
      <section
        id="cardapio"
        className="process-section scroll-reveal"
        ref={processRef}
      >
        <div className="process-header">
          <span className="process-label">Como funciona</span>
          <h2 className="process-title">
            Um momento especial entre se cuidar e se deliciar.
          </h2>
        </div>

        <div className="process-cards">
          {/* Card 1 — Faça seu pedido */}
          <div className="step-card">
            <div className="icon-badge">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <rect
                  x="5"
                  y="2"
                  width="14"
                  height="20"
                  rx="2.5"
                  stroke="#634738"
                  strokeWidth="1.8"
                  fill="none"
                />
                <line
                  x1="9"
                  y1="4.5"
                  x2="15"
                  y2="4.5"
                  stroke="#634738"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                />
                <circle cx="12" cy="19.5" r="1" fill="#634738" />
                <path
                  d="M8 12.5L10.5 15L16 9.5"
                  stroke="#634738"
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
            <div className="step-text">
              <h3 className="step-title">Faça seu pedido</h3>
              <p className="step-description">
                Escolha entre nossos sabores disponíveis aqui no site, ou no
                salão
              </p>
            </div>
          </div>

          {/* Card 2 — Momento Relax */}
          <div className="step-card">
            <div className="icon-badge">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                {/* Pote — corpo com fundo arredondado */}
                <path
                  d="M5 8.5C5 8.5 5 18 5.5 19C6 20 7 20.5 12 20.5C17 20.5 18 20 18.5 19C19 18 19 8.5 19 8.5"
                  stroke="#634738"
                  strokeWidth="1.6"
                  fill="none"
                  strokeLinecap="round"
                />
                {/* Tampa */}
                <rect x="4" y="7" width="16" height="2" rx="1" fill="#634738" />
                {/* Camada 1 — chocolate */}
                <rect
                  x="6"
                  y="16"
                  width="12"
                  height="3"
                  rx="0.5"
                  fill="#634738"
                  opacity="0.7"
                />
                {/* Camada 2 — creme */}
                <rect
                  x="6"
                  y="13"
                  width="12"
                  height="3"
                  rx="0.5"
                  fill="#EDDCC6"
                />
                {/* Camada 3 — morango/rosa */}
                <rect
                  x="6"
                  y="10"
                  width="12"
                  height="3"
                  rx="0.5"
                  fill="#D38B80"
                  opacity="0.8"
                />
                {/* Cobertura chantilly no topo — ondulada */}
                <path
                  d="M7 10C7 10 8 8.5 9.5 9C11 9.5 10.5 8 12 8C13.5 8 13 9.5 14.5 9C16 8.5 17 10 17 10"
                  fill="#FAF6F0"
                  stroke="#EADFD3"
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
                    stroke="#634738"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                  />
                  {/* Cabeça da colher */}
                  <ellipse cx="15" cy="6.5" rx="1.8" ry="1.2" fill="#634738" />
                  {/* Reflexo na colher */}
                  <ellipse
                    cx="14.5"
                    cy="6.3"
                    rx="0.6"
                    ry="0.4"
                    fill="#8C7A76"
                  />
                </g>
              </svg>
            </div>
            <div className="step-text">
              <h3 className="step-title">Momento Relax</h3>
              <p className="step-description">
                Saboreie seu bolo ou pudim enquanto realiza seus procedimentos
                de beleza e autocuidado
              </p>
            </div>
          </div>

          {/* Card 3 — Adorável rotina */}
          <div className="step-card">
            <div className="icon-badge">
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
                    stroke="#634738"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  />
                  <rect
                    x="5"
                    y="7"
                    width="14"
                    height="4"
                    rx="1"
                    stroke="#634738"
                    strokeWidth="1.8"
                    fill="none"
                  />
                  <path
                    d="M6.5 11V18C6.5 19.1 7.4 20 8.5 20H15.5C16.6 20 17.5 19.1 17.5 18V11"
                    stroke="#634738"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  />
                </g>
              </svg>
            </div>
            <div className="step-text">
              <h3 className="step-title">Adorável rotina</h3>
              <p className="step-description">
                Leve bolos para adoçar a familia! Com embalagens seguras e
                prontas para viagem!
              </p>
            </div>
          </div>
        </div>

        <Link to="/cardapio" className="btn-cardapio">
          Ver cardápio
        </Link>
      </section>

      {/* ===== INSTAGRAM ===== */}
      <section className="instagram-section scroll-reveal" ref={instaRef}>
        <div className="instagram-header">
          <div className="instagram-title-group">
            <span className="section-tag">Acompanhe-nos</span>
            <h2>Suspiros diários no @rpdoces</h2>
          </div>
          <a
            href="https://instagram.com/rp.doces"
            className="btn-instagram"
            target="_blank"
            rel="noopener noreferrer"
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
          <span className="section-tag">Venha nos Visitar</span>
          <h2>Onde Encontrar</h2>
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
                  stroke="#634738"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
              </div>
              <div>
                <span className="contact-label">Localização</span>
                <h3>Temponi Concept</h3>
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
                    stroke="#634738"
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
                  <p>Rua Luís Barrozi Pereira, 582 - Sala 07</p>
                  <p>Cambuí, Campinas - SP</p>
                </div>
              </div>

              <div className="contact-info-item">
                <div className="contact-icon-bg">
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#634738"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                </div>
                <div>
                  <h4>Horário de Funcionamento</h4>
                  <p>Seg a Sáb: 9h às 18h</p>
                </div>
              </div>

              <div className="contact-info-item">
                <div className="contact-icon-bg">
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#634738"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.362 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.338 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
                  </svg>
                </div>
                <div>
                  <h4>WhatsApp para Encomendas</h4>
                  <p>(19) 99128-5807</p>
                </div>
              </div>

              <div className="contact-info-item">
                <div className="contact-icon-bg">
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#634738"
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
                  <p>@rp.doces</p>
                </div>
              </div>
            </div>

            <a
              href="https://wa.me/5519991285807"
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
