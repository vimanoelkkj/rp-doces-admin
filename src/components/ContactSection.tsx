import {
  deliveryStatusLabel,
  formatStoreSchedule,
  formatStoreWhatsapp,
  storeWhatsappHref,
  type StoreConfig
} from "../api/storeConfig";
import { useScrollReveal } from "../hooks/useScrollReveal";
import { INSTAGRAM_WEB_URL, openInstagram } from "../lib/instagram";

interface ContactSectionProps {
  storeConfig: StoreConfig;
}

// Seção "Nosso espaço" (âncora #onde-estamos): localização, endereço, horário, WhatsApp e Instagram da
// loja, a partir da configuração pública. Endereço e WhatsApp são selecionáveis (.selectable). As classes
// vêm de Homepage.css.
export default function ContactSection({ storeConfig }: ContactSectionProps) {
  const contactRef = useScrollReveal<HTMLElement>();
  const storeSchedule = formatStoreSchedule(
    storeConfig.days,
    storeConfig.openTime,
    storeConfig.closeTime
  );
  const storeDelivery = deliveryStatusLabel(storeConfig.deliveryStatus);
  const storeWhatsapp = formatStoreWhatsapp(storeConfig.whatsapp);
  const storeWhatsappUrl = storeWhatsappHref(storeConfig.whatsapp, storeConfig.defaultMessage);

  return (
    <section className="contact-section scroll-reveal" id="onde-estamos" ref={contactRef}>
      <div className="contact-header">
        <span className="section-tag">Nosso Espaço</span>
        <h2>Nosso cantinho no Cambuí</h2>
      </div>

      <div className="contact-card">
        <div className="contact-accent-bar" aria-hidden="true" />
        <div className="contact-content">
          <div className="contact-location-header contact-info-item">
            <div className="contact-icon-wrap" aria-hidden="true">
              <svg
                aria-hidden="true"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--store-header-icon-stroke)"
                strokeWidth="1.9"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                <polyline points="9 22 9 12 15 12 15 22" />
              </svg>
            </div>
            <div className="contact-info-text">
              <h4>Localização</h4>
              <p>{storeConfig.localName}</p>
            </div>
          </div>

          <hr className="contact-divider" />

          <div className="contact-info-grid">
            <div className="contact-info-item">
              <div className="contact-icon-wrap" aria-hidden="true">
                <svg
                  aria-hidden="true"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="var(--store-header-icon-stroke)"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
              </div>
              <div className="contact-info-text">
                <h4>Endereço</h4>
                {storeConfig.mapsLink ? (
                  <a
                    href={storeConfig.mapsLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: "inherit", textDecoration: "none" }}
                  >
                    <p className="selectable">{storeConfig.address}</p>
                  </a>
                ) : (
                  <p className="selectable">{storeConfig.address}</p>
                )}
              </div>
            </div>

            <div className="contact-info-item">
              <div className="contact-icon-wrap" aria-hidden="true">
                <svg
                  aria-hidden="true"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="var(--store-header-icon-stroke)"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
              </div>
              <div className="contact-info-text">
                <h4>Atendimento</h4>
                <p>{storeSchedule}</p>
                <p>{storeDelivery}</p>
              </div>
            </div>

            <div className="contact-info-item">
              <div className="contact-icon-wrap" aria-hidden="true">
                <svg
                  aria-hidden="true"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="var(--store-header-icon-stroke)"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.362 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.338 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
                </svg>
              </div>
              <div className="contact-info-text">
                <h4>WhatsApp para Encomendas</h4>
                <p className="selectable">{storeWhatsapp}</p>
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
              <div className="contact-icon-wrap" aria-hidden="true">
                <svg
                  aria-hidden="true"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="var(--store-header-icon-stroke)"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
                  <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
                  <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
                </svg>
              </div>
              <div className="contact-info-text">
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
  );
}
