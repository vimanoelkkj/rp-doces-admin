interface LojaPreviewPanelProps {
  localName: string;
  address: string;
  scheduleText: string;
  deliveryLabel: string;
  whatsapp: string;
}

// Seção "Prévia da loja" (Admin > Loja): mostra como retirada, atendimento, entregas e WhatsApp aparecem no
// site, a partir dos valores do formulário. Só apresentação. As classes vêm de AdminLoja.css.
export default function LojaPreviewPanel({
  localName,
  address,
  scheduleText,
  deliveryLabel,
  whatsapp
}: LojaPreviewPanelProps) {
  return (
    <section className="loj-panel">
      <h2 className="loj-panel-title">Prévia da loja</h2>
      <div className="loj-preview-card">
        <span className="loj-preview-name">R&P Doces</span>
        <div className="loj-preview-row">
          <svg
            aria-hidden="true"
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            stroke="#8c7a76"
            strokeWidth="1.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M7 1.5C4.5 1.5 2.5 3.5 2.5 6c0 3.5 4.5 6.5 4.5 6.5s4.5-3 4.5-6.5c0-2.5-2-4.5-4.5-4.5z" />
            <circle cx="7" cy="6" r="1.5" />
          </svg>
          <span>Retirada: {localName}</span>
        </div>
        <span className="loj-preview-address">{address}</span>
        <div className="loj-preview-row">
          <svg
            aria-hidden="true"
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            stroke="#8c7a76"
            strokeWidth="1.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="7" cy="7" r="5.5" />
            <path d="M7 3.5V7l2.5 1.5" />
          </svg>
          <span>{scheduleText}</span>
        </div>
        <div className="loj-preview-row loj-preview-row--muted">
          <svg
            aria-hidden="true"
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            stroke="#8c7a76"
            strokeWidth="1.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="1" y="4" width="12" height="7" rx="1.5" />
            <path d="M3 4V3a1 1 0 011-1h6a1 1 0 011 1v1M1 8h12" />
          </svg>
          <span>{deliveryLabel}</span>
        </div>
        <div className="loj-preview-row">
          <svg
            aria-hidden="true"
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            stroke="#8c7a76"
            strokeWidth="1.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {/* HUMAN-15: era um retângulo com uma faixa — lia-se como
                  cartão de crédito, não como WhatsApp. Agora é o balão
                  com o fone. Só o desenho mudou: tamanho, stroke, cor,
                  alinhamento e espaçamento da linha continuam iguais
                  aos dos outros ícones da prévia. */}
            <path d="M2.4 11.6l.7-2.4a4.9 4.9 0 112 1.9l-2.7.5z" />
            <path d="M5.6 5.6c.2 1.6 1.4 2.8 3 3 .4 0 .7-.2.8-.5l.2-.4-1-.6-.5.5c-.7-.3-1.2-.8-1.5-1.5l.5-.5-.6-1-.4.2c-.3.1-.5.4-.5.8z" />
          </svg>
          <span>WhatsApp: {whatsapp}</span>
        </div>
      </div>
    </section>
  );
}
