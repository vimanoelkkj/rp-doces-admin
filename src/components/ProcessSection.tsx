import { Link } from "react-router-dom";
import { useScrollReveal } from "../hooks/useScrollReveal";

// Ícones animados das três etapas. Estáticos (sem props), por isso ficam fora do componente.
const ICONE_CELULAR = (
  <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none">
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
);

const ICONE_POTE = (
  <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none">
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
    <rect x="6" y="13" width="12" height="3" rx="0.5" fill="var(--store-wave-primary)" />
    {/* Camada 3 — morango/rosa */}
    <rect x="6" y="10" width="12" height="3" rx="0.5" fill="var(--store-accent)" opacity="0.85" />
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
      <ellipse cx="14.5" cy="6.3" rx="0.6" ry="0.4" fill="var(--store-text-subtle)" />
    </g>
  </svg>
);

const ICONE_PRESENTE = (
  <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none">
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
);

// Seção "Como funciona": cabeçalho, as três etapas da jornada e o botão para o cardápio (âncora #cardapio).
// As classes vêm de Homepage.css.
export default function ProcessSection() {
  const processHeaderRef = useScrollReveal<HTMLDivElement>();
  const step1Ref = useScrollReveal<HTMLElement>();
  const step2Ref = useScrollReveal<HTMLElement>();
  const step3Ref = useScrollReveal<HTMLElement>();
  const processCtaRef = useScrollReveal<HTMLDivElement>();

  return (
    <section id="cardapio" className="process-section">
      <div className="process-header scroll-reveal" ref={processHeaderRef}>
        <span className="process-label">Como funciona</span>
        <h2 className="process-title">Um momento especial entre se cuidar e se deliciar.</h2>
      </div>

      <div className="process-journey">
        {/* Etapa 1 — Seu pedido, do seu jeito */}
        <article className="journey-step journey-step--1 scroll-reveal" ref={step1Ref}>
          <div className="journey-step__marker">{ICONE_CELULAR}</div>
          <div className="journey-step__content">
            <h3 className="journey-step__title">Seu pedido, do seu jeito</h3>
            <p className="journey-step__desc">
              Escolha entre nossos sabores disponíveis aqui no site, ou no salão
            </p>
          </div>
        </article>

        {/* Etapa 2 — Uma pausa para saborear */}
        <article className="journey-step journey-step--2 scroll-reveal" ref={step2Ref}>
          <div className="journey-step__marker">{ICONE_POTE}</div>
          <div className="journey-step__content">
            <h3 className="journey-step__title">Uma pausa para saborear</h3>
            <p className="journey-step__desc">
              Saboreie seu bolo ou pudim enquanto realiza seus procedimentos de beleza e autocuidado
            </p>
          </div>
        </article>

        {/* Etapa 3 — Um carinho que acompanha */}
        <article className="journey-step journey-step--3 scroll-reveal" ref={step3Ref}>
          <div className="journey-step__marker">{ICONE_PRESENTE}</div>
          <div className="journey-step__content">
            <h3 className="journey-step__title">Um carinho que acompanha</h3>
            <p className="journey-step__desc">
              Leve bolos para adoçar a familia! Com embalagens seguras e prontas para viagem!
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
  );
}
