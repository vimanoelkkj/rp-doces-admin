import "./ProcessandoPagamento.css";

export default function ProcessandoPagamento() {
  return (
    <div className="processando-screen">
      <div className="processando-content">
        <div className="processando-donut">
          <svg className="donut-spinner" width="120" height="120" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
            {/* Donut body */}
            <circle cx="60" cy="56" r="40" fill="#D38B80"/>

            {/* Donut hole */}
            <circle cx="60" cy="56" r="16" fill="#FAF6F0"/>

            {/* Inner hole depth */}
            <circle cx="60" cy="56" r="17" fill="none" stroke="#C07A70" strokeWidth="1" opacity="0.2"/>

            {/* Chocolate frosting — top only */}
            <path d="M20 48C22 30 40 16 60 16C80 16 98 30 100 48
                     C100 48 96 42 88 40C80 38 72 40 60 40
                     C48 40 40 38 32 40C24 42 20 48 20 48Z"
                  fill="#634738"/>

            {/* Drips — outer edges only */}
            <path d="M24 48Q23 52 24 56Q25 59 27 57Q27 54 26 50L24 48Z" fill="#634738"/>
            <path d="M36 46Q34 52 35 58Q36 62 39 60Q39 56 38 50L36 46Z" fill="#634738"/>
            <path d="M84 46Q83 52 84 60Q85 64 88 62Q88 58 86 50L84 46Z" fill="#634738"/>
            <path d="M96 48Q95 52 96 56Q97 59 99 57Q99 54 98 50L96 48Z" fill="#634738"/>

            {/* Frosting highlight */}
            <path d="M36 34C42 26 50 22 60 20C66 20 72 22 76 26
                     C70 22 64 22 60 22C50 22 42 28 38 36C37 37 36 36 36 34Z"
                  fill="#EADFD3" opacity="0.35"/>

            {/* Sprinkles */}
            <rect x="40" y="30" width="6" height="2.5" rx="1.25" fill="#D38B80" transform="rotate(-20 40 30)"/>
            <rect x="52" y="24" width="6" height="2.5" rx="1.25" fill="#EADFD3" transform="rotate(15 52 24)"/>
            <rect x="68" y="26" width="6" height="2.5" rx="1.25" fill="#D38B80" transform="rotate(-30 68 26)"/>
            <rect x="78" y="32" width="6" height="2.5" rx="1.25" fill="#EADFD3" transform="rotate(25 78 32)"/>
            <rect x="46" y="36" width="5" height="2.5" rx="1.25" fill="#EADFD3" transform="rotate(-10 46 36)"/>
            <rect x="72" y="36" width="5" height="2.5" rx="1.25" fill="#D38B80" transform="rotate(40 72 36)"/>
          </svg>
        </div>

        <div className="processando-dots">
          <span className="processando-dot" />
          <span className="processando-dot" />
          <span className="processando-dot" />
        </div>

        <h2 className="processando-title">Processando pagamento...</h2>
        <p className="processando-subtitle">Aguarde enquanto confirmamos</p>
      </div>

      <p className="processando-footer">R&P Doces</p>
    </div>
  );
}
