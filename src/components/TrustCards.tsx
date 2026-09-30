import "./TrustCards.css";

export default function TrustCards() {
  return (
    <div className="trust-cards-wrapper">
      <div className="trust-cards trust-cards-grid">
        <AtelierIngredientsCard />
        <AtelierCareCard />
      </div>
    </div>
  );
}

/* =========================================================================
   DIREÇÃO A: ATELIER CONFEITARIA (Selo editorial & Medalhão artesanal)
========================================================================= */

function AtelierIngredientsCard() {
  return (
    <div className="trust-card refined-trust-card trust-card--atelier">
      <div className="atelier-medal">
        <svg
          className="atelier-svg"
          viewBox="0 0 64 64"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <defs>
            <radialGradient
              id="berryGradient"
              cx="22"
              cy="27"
              r="14"
              gradientUnits="userSpaceOnUse"
            >
              <stop stopColor="#E2948A" />
              <stop offset="0.65" stopColor="#D38B80" />
              <stop offset="1" stopColor="#B45B51" />
            </radialGradient>
            <linearGradient
              id="chocoBarGrad"
              x1="36"
              y1="24"
              x2="52"
              y2="44"
              gradientUnits="userSpaceOnUse"
            >
              <stop stopColor="#735446" />
              <stop offset="0.4" stopColor="#634738" />
              <stop offset="1" stopColor="#483227" />
            </linearGradient>
            <linearGradient
              id="leafGrad"
              x1="16"
              y1="18"
              x2="28"
              y2="24"
              gradientUnits="userSpaceOnUse"
            >
              <stop stopColor="#6D856B" />
              <stop offset="1" stopColor="#4D614B" />
            </linearGradient>
          </defs>

          {/* Sombra de apoio suave na base */}
          <ellipse cx="32" cy="51" rx="20" ry="3.5" fill="rgba(99, 71, 56, 0.08)" />

          {/* Grupo do Morango com flutuação de pêndulo */}
          <g className="atelier-strawberry-group">
            {/* Folhas da coroa do morango (sépala esculpida) */}
            <path
              d="M17.5 24C16 20 18.5 17 21.5 18.5C22.5 19 23.5 17.5 25.5 18C27 18.5 28 20.5 26.5 23.5C28 23 29.5 24.5 28.5 26C27.5 27 24 25.5 22 25.5C19.5 25.5 18 25 17.5 24Z"
              fill="url(#leafGrad)"
            />
            {/* Haste delicada */}
            <path
              d="M22 18.5C22 15.5 24 14 25 13.5"
              stroke="#4D614B"
              strokeWidth="1.8"
              strokeLinecap="round"
            />

            {/* Corpo do morango */}
            <path
              d="M16 25C15 29 16 38 22.5 43.5C29 38 30 29 29 25C29 23.5 25.5 24 22.5 24C19.5 24 16 23.5 16 25Z"
              fill="url(#berryGradient)"
            />

            {/* Sementes douradas/marfim delicadas em relevo */}
            <circle cx="19.5" cy="28.5" r="0.9" fill="#FAF6F0" opacity="0.95" />
            <circle cx="25.5" cy="28.5" r="0.9" fill="#FAF6F0" opacity="0.95" />
            <circle cx="22.5" cy="32.5" r="1.1" fill="#FAF6F0" opacity="0.95" />
            <circle cx="18.5" cy="34.5" r="0.8" fill="#FAF6F0" opacity="0.9" />
            <circle cx="26.5" cy="34.5" r="0.8" fill="#FAF6F0" opacity="0.9" />
            <circle cx="21" cy="38" r="0.75" fill="#FAF6F0" opacity="0.9" />
            <circle cx="24" cy="38" r="0.75" fill="#FAF6F0" opacity="0.9" />
            <circle cx="22.5" cy="41" r="0.6" fill="#FAF6F0" opacity="0.85" />

            {/* Brilho especular sutil na curva superior */}
            <path
              d="M18 27C17.5 29 18 33 19 35"
              stroke="#FFFFFF"
              strokeWidth="0.8"
              strokeLinecap="round"
              opacity="0.35"
            />

            {/* Gotinha de calda cremosa no ápice */}
            <path
              className="atelier-syrup-drip"
              d="M22.5 43.5C22.5 43.5 21 45.5 21.8 46.8C22.4 47.6 23.2 47.4 23.6 46.8C24.2 45.5 22.5 43.5 22.5 43.5Z"
              fill="#B45B51"
            />
          </g>

          {/* Barra de Chocolate Nobre em Perspectiva */}
          <g>
            {/* Bloco principal de chocolate */}
            <rect x="34" y="27" width="16" height="20" rx="2.5" fill="url(#chocoBarGrad)" />
            {/* Chanfros dos tabletes */}
            <line x1="42" y1="28" x2="42" y2="46" stroke="#483227" strokeWidth="1.2" />
            <line x1="35" y1="36" x2="49" y2="36" stroke="#483227" strokeWidth="1.2" />
            {/* Iluminação de borda no topo da barra */}
            <line
              x1="35"
              y1="28"
              x2="49"
              y2="28"
              stroke="#8C7A76"
              strokeWidth="0.8"
              opacity="0.5"
            />
          </g>

          {/* Pedaço destacado de chocolate em levitação sutil */}
          <g className="atelier-choco-piece">
            <rect
              x="43"
              y="18"
              width="8.5"
              height="8.5"
              rx="1.5"
              fill="#735446"
              stroke="#543C30"
              strokeWidth="0.75"
            />
            {/* Brilho no tablete solto */}
            <path
              d="M44.5 19.5L50 19.5"
              stroke="#FAF6F0"
              strokeWidth="0.75"
              strokeLinecap="round"
              opacity="0.55"
            />
          </g>
        </svg>
      </div>

      <div className="refined-trust-card-text">
        <strong className="refined-trust-card-title">Ingredientes Premium</strong>
        <span className="refined-trust-card-desc">Leite moça e frutas frescas</span>
      </div>
    </div>
  );
}

function AtelierCareCard() {
  return (
    <div className="trust-card refined-trust-card trust-card--atelier">
      <div className="atelier-medal">
        <svg
          className="atelier-svg"
          viewBox="0 0 64 64"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <defs>
            <linearGradient
              id="copperBowlGrad"
              x1="18"
              y1="38"
              x2="46"
              y2="52"
              gradientUnits="userSpaceOnUse"
            >
              <stop stopColor="#8C6352" />
              <stop offset="0.5" stopColor="#634738" />
              <stop offset="1" stopColor="#4A3428" />
            </linearGradient>
            <radialGradient id="heartPinkGrad" cx="32" cy="24" r="8" gradientUnits="userSpaceOnUse">
              <stop stopColor="#E2948A" />
              <stop offset="0.75" stopColor="#D38B80" />
              <stop offset="1" stopColor="#BA665A" />
            </radialGradient>
          </defs>

          {/* Sombra de apoio suave na base */}
          <ellipse cx="32" cy="52" rx="18" ry="3" fill="rgba(99, 71, 56, 0.08)" />

          {/* Recipiente / Concha de Cerâmica e Cobre Artesanal */}
          <g>
            <path
              d="M20 42C20 47.5 25.5 50.5 32 50.5C38.5 50.5 44 47.5 44 42C44 40.5 43 39.5 41.5 39.5C38 39.8 35 40 32 40C29 40 26 39.8 22.5 39.5C21 39.5 20 40.5 20 42Z"
              fill="url(#copperBowlGrad)"
            />
            {/* Borda dourada/cobre da tigela */}
            <path
              d="M20.5 41.5C24 42.2 28 42.5 32 42.5C36 42.5 40 42.2 43.5 41.5"
              stroke="#D38B80"
              strokeWidth="1.2"
              strokeLinecap="round"
              opacity="0.8"
            />
          </g>

          {/* Vapor de Afeto: Coração Esquerda (S-curve) */}
          <g className="atelier-heart-steam-1">
            <path
              d="M20 38C20 38 14 32.5 14 29C14 26.5 16.5 24.5 19 25.8C19.7 26.1 20 27 20 27C20 27 20.3 26.1 21 25.8C23.5 24.5 26 26.5 26 29C26 32.5 20 38 20 38Z"
              fill="url(#heartPinkGrad)"
            />
          </g>

          {/* Vapor de Afeto: Coração Centro (Maior, elevação harmônica) */}
          <g className="atelier-heart-steam-2">
            <path
              d="M32 37C32 37 23.5 29 23.5 24.5C23.5 21.5 26.5 19.5 29.5 20.8C30.5 21.2 32 22.8 32 22.8C32 22.8 33.5 21.2 34.5 20.8C37.5 19.5 40.5 21.5 40.5 24.5C40.5 29 32 37 32 37Z"
              fill="url(#heartPinkGrad)"
            />
            {/* Brilho no coração principal */}
            <path
              d="M26.5 23C26.5 22 28 21.5 29 21.8"
              stroke="#FAF6F0"
              strokeWidth="0.8"
              strokeLinecap="round"
              opacity="0.65"
            />
          </g>

          {/* Vapor de Afeto: Coração Direita (Menor e arejado) */}
          <g className="atelier-heart-steam-3">
            <path
              d="M44 38C44 38 39.5 33.5 39.5 31C39.5 29.2 41.2 27.8 43 28.6C43.5 28.8 44 29.5 44 29.5C44 29.5 44.5 28.8 45 28.6C46.8 27.8 48.5 29.2 48.5 31C48.5 33.5 44 38 44 38Z"
              fill="url(#heartPinkGrad)"
            />
          </g>
        </svg>
      </div>

      <div className="refined-trust-card-text">
        <strong className="refined-trust-card-title">Feito com Carinho</strong>
        <span className="refined-trust-card-desc">Sempre fresquinho e cremoso</span>
      </div>
    </div>
  );
}
