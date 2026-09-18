import { useState } from "react";
import "./AdminLoja.css";
import { formatScheduleText } from "./scheduleText";

/* ── Types ── */
interface DayToggle {
  label: string;
  active: boolean;
}

/* ── Component ── */
export default function AdminLoja() {
  /* Atendimento */
  const [days, setDays] = useState<DayToggle[]>([
    { label: "Seg", active: false },
    { label: "Ter", active: true },
    { label: "Qua", active: true },
    { label: "Qui", active: true },
    { label: "Sex", active: true },
    { label: "Sáb", active: true },
    { label: "Dom", active: false },
  ]);
  const [openTime, setOpenTime] = useState("09:00");
  const [closeTime, setCloseTime] = useState("20:00");

  /* Retirada */
  const [localName, setLocalName] = useState("Temponi Concept");
  const [address, setAddress] = useState(
    "Rua Lais Bertoni Pereira 182 Cambuí Sala 07",
  );
  const [mapsLink, setMapsLink] = useState(
    "https://maps.google.com/?q=Temponi+Concept",
  );

  /* Entregas */
  const [deliveryStatus, setDeliveryStatus] = useState<
    "soon" | "available" | "unavailable"
  >("unavailable");

  /* Contato */
  const [whatsapp, setWhatsapp] = useState("(33) 99128-5907");
  const [defaultMessage, setDefaultMessage] = useState(
    "Olá! Gostaria de fazer um pedido de bolo.",
  );

  /* Imagens */
  const [heroImg, setHeroImg] = useState<string | null>("/images/hero.jpg");
  const [storyImg, setStoryImg] = useState<string | null>("/images/story.jpg");

  const toggleDay = (index: number) => {
    setDays((prev) =>
      prev.map((d, i) => (i === index ? { ...d, active: !d.active } : d)),
    );
  };

  /* Prévia helpers */
  const scheduleText = formatScheduleText(days, openTime, closeTime);

  const deliveryLabel =
    deliveryStatus === "available"
      ? "Entregas disponíveis"
      : deliveryStatus === "soon"
        ? "Entregas em breve"
        : "Entregas indisponíveis";

  return (
    <main className="loj-main">
        {/* ── Header ── */}
        <header className="loj-header">
          <h1 className="loj-title">Loja</h1>
          <p className="loj-subtitle">
            Atendimento, contato e aparência do site público
          </p>
        </header>

        {/* ── Two-column split ── */}
        <div className="loj-columns">
          {/* ── Left column ── */}
          <div className="loj-col-left">
            {/* Atendimento */}
            <section className="loj-panel">
              <h2 className="loj-panel-title">Atendimento</h2>

              <div className="loj-field">
                <span className="loj-field-label">Dias de funcionamento</span>
                <div className="loj-days-row">
                  {days.map((day, i) => (
                    <button
                      key={day.label}
                      className={`loj-day-pill ${day.active ? "loj-day-pill--active" : ""}`}
                      onClick={() => toggleDay(i)}
                    >
                      {day.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="loj-hours-row">
                <div className="loj-field">
                  <span className="loj-field-label">Abre</span>
                  <input
                    type="time"
                    className="loj-input"
                    value={openTime}
                    onChange={(e) => setOpenTime(e.target.value)}
                  />
                </div>
                <div className="loj-field">
                  <span className="loj-field-label">Fecha</span>
                  <input
                    type="time"
                    className="loj-input"
                    value={closeTime}
                    onChange={(e) => setCloseTime(e.target.value)}
                  />
                </div>
              </div>
            </section>

            {/* Retirada */}
            <section className="loj-panel">
              <h2 className="loj-panel-title">Retirada</h2>

              <div className="loj-field">
                <span className="loj-field-label">Nome do local</span>
                <input
                  type="text"
                  className="loj-input"
                  value={localName}
                  onChange={(e) => setLocalName(e.target.value)}
                />
              </div>
              <div className="loj-field">
                <span className="loj-field-label">Endereço</span>
                <input
                  type="text"
                  className="loj-input"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                />
              </div>
              <div className="loj-field">
                <span className="loj-field-label">Link do Google Maps</span>
                <input
                  type="text"
                  className="loj-input loj-input--link"
                  value={mapsLink}
                  onChange={(e) => setMapsLink(e.target.value)}
                />
              </div>
            </section>

            {/* Entregas */}
            <section className="loj-panel">
              <h2 className="loj-panel-title">Entregas</h2>
              <div className="loj-delivery-row">
                <button
                  className={`loj-delivery-pill ${deliveryStatus === "soon" ? "loj-delivery-pill--active" : ""}`}
                  onClick={() => setDeliveryStatus("soon")}
                >
                  Em breve
                </button>
                <button
                  className={`loj-delivery-pill ${deliveryStatus === "available" ? "loj-delivery-pill--active" : ""}`}
                  onClick={() => setDeliveryStatus("available")}
                >
                  Disponíveis
                </button>
                <button
                  className={`loj-delivery-pill ${deliveryStatus === "unavailable" ? "loj-delivery-pill--active" : ""}`}
                  onClick={() => setDeliveryStatus("unavailable")}
                >
                  Indisponíveis
                </button>
              </div>
            </section>
          </div>

          {/* ── Right column ── */}
          <div className="loj-col-right">
            {/* Prévia da loja */}
            <section className="loj-panel">
              <h2 className="loj-panel-title">Prévia da loja</h2>
              <div className="loj-preview-card">
                <span className="loj-preview-name">R&P Doces</span>
                <div className="loj-preview-row">
                  <svg
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

            {/* Contato */}
            <section className="loj-panel">
              <h2 className="loj-panel-title">Contato</h2>
              <div className="loj-field">
                <span className="loj-field-label">WhatsApp</span>
                <input
                  type="text"
                  className="loj-input"
                  value={whatsapp}
                  onChange={(e) => setWhatsapp(e.target.value)}
                />
              </div>
              <div className="loj-field">
                <span className="loj-field-label">Mensagem padrão</span>
                <textarea
                  className="loj-textarea"
                  value={defaultMessage}
                  onChange={(e) => setDefaultMessage(e.target.value)}
                  rows={3}
                />
              </div>
            </section>

            {/* Imagens da página inicial */}
            <section className="loj-panel">
              <h2 className="loj-panel-title">Imagens da página inicial</h2>
              <div className="loj-images-row">
                <div className="loj-image-slot">
                  <div className="loj-image-thumb">
                    {heroImg ? (
                      <img src={heroImg} alt="Imagem principal" />
                    ) : (
                      <span className="loj-image-empty">Sem imagem</span>
                    )}
                  </div>
                  <span className="loj-image-label">Imagem principal</span>
                  <div className="loj-image-actions">
                    <button className="loj-image-link">Escolher</button>
                    <button
                      className="loj-image-link"
                      onClick={() => setHeroImg(null)}
                    >
                      Remover
                    </button>
                  </div>
                </div>
                <div className="loj-image-slot">
                  <div className="loj-image-thumb">
                    {storyImg ? (
                      <img src={storyImg} alt="Nossa história" />
                    ) : (
                      <span className="loj-image-empty">Sem imagem</span>
                    )}
                  </div>
                  <span className="loj-image-label">Nossa história</span>
                  <div className="loj-image-actions">
                    <button className="loj-image-link">Escolher</button>
                    <button
                      className="loj-image-link"
                      onClick={() => setStoryImg(null)}
                    >
                      Remover
                    </button>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>

        {/* ── Save bar ── */}
        <div className="loj-save-bar">
          <button className="loj-btn-save">Salvar alterações</button>
        </div>

        {/* ── Diagnósticos permanentes ── */}
        <section className="loj-diag-panel">
          <div className="loj-diag-header">
            <div>
              <h2 className="loj-diag-title">Diagnósticos permanentes</h2>
              <p className="loj-diag-subtitle">
                Testes operacionais e utilitários da loja
              </p>
            </div>
            <span className="loj-badge-owner">OWNER</span>
          </div>

          <div className="loj-diag-grid">
            {/* Pix */}
            <div className="loj-diag-card">
              <div className="loj-diag-card-header">
                <span className="loj-diag-card-title">
                  Pix real de diagnóstico
                </span>
                <span className="loj-badge-cost">R$ 0,01</span>
              </div>
              <p className="loj-diag-card-desc">
                Cria um Pix real de centavos para confirmar que a integração com
                o banco está de pé e ativa.
              </p>
              <button className="loj-diag-action">Gerar QR Code Pix</button>
            </div>

            {/* Pedido teste */}
            <div className="loj-diag-card">
              <div className="loj-diag-card-header">
                <span className="loj-diag-card-title">
                  Pedido de produto de teste
                </span>
                <span className="loj-badge-test">TEST</span>
              </div>
              <p className="loj-diag-card-desc">
                Gera um fluxo simulado de pedido fictício de bolo para verificar
                se as notificações e sons do painel administrativo estão
                operando.
              </p>
              <button className="loj-diag-action">Disparar pedido teste</button>
            </div>
          </div>
        </section>
      </main>
  );
}
