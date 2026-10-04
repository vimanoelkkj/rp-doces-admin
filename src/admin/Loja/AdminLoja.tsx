import { useCallback, useEffect, useState } from "react";
import "./AdminLoja.css";
import { formatScheduleText } from "./scheduleText";
import ImagensPaginaInicialPanel from "./ImagensPaginaInicialPanel";
import LojaPreviewPanel from "./LojaPreviewPanel";
import PixDiagnosticoPanel from "./PixDiagnosticoPanel";
import PushTestePanel from "./PushTestePanel";
import { fetchStoreConfig, saveStoreConfig, type StoreConfig } from "../../api/storeConfig";

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
    { label: "Dom", active: false }
  ]);
  const [openTime, setOpenTime] = useState("09:00");
  const [closeTime, setCloseTime] = useState("20:00");

  /* Retirada */
  const [localName, setLocalName] = useState("Temponi Concept");
  const [address, setAddress] = useState("Rua Lais Bertoni Pereira 182 Cambuí Sala 07");
  const [mapsLink, setMapsLink] = useState("https://maps.google.com/?q=Temponi+Concept");

  /* Entregas */
  const [deliveryStatus, setDeliveryStatus] = useState<"soon" | "available" | "unavailable">(
    "unavailable"
  );

  /* Contato */
  const [whatsapp, setWhatsapp] = useState("(33) 99128-5907");
  const [defaultMessage, setDefaultMessage] = useState("Olá! Gostaria de fazer um pedido de bolo.");

  /* Configuração pública persistida */
  const [configLoading, setConfigLoading] = useState(true);
  const [configSaving, setConfigSaving] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const [configSaved, setConfigSaved] = useState(false);

  const aplicarConfiguracao = useCallback((config: StoreConfig) => {
    setDays(config.days.map(day => ({ ...day })));
    setOpenTime(config.openTime);
    setCloseTime(config.closeTime);
    setLocalName(config.localName);
    setAddress(config.address);
    setMapsLink(config.mapsLink);
    setDeliveryStatus(config.deliveryStatus);
    setWhatsapp(config.whatsapp);
    setDefaultMessage(config.defaultMessage);
  }, []);

  useEffect(() => {
    let active = true;
    setConfigLoading(true);
    void fetchStoreConfig()
      .then(config => {
        if (!active) return;
        aplicarConfiguracao(config);
        setConfigError(null);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setConfigError(
          err instanceof Error ? err.message : "Falha ao carregar configurações da loja"
        );
      })
      .finally(() => {
        if (active) setConfigLoading(false);
      });

    return () => {
      active = false;
    };
  }, [aplicarConfiguracao]);

  const salvarConfiguracoes = async () => {
    if (configSaving || configLoading) return;

    setConfigSaving(true);
    setConfigError(null);
    setConfigSaved(false);

    try {
      const config = await saveStoreConfig({
        days: days.map(day => ({ ...day })),
        openTime,
        closeTime,
        localName,
        address,
        mapsLink,
        deliveryStatus,
        whatsapp,
        defaultMessage
      });
      aplicarConfiguracao(config);
      setConfigSaved(true);
      window.setTimeout(() => setConfigSaved(false), 3000);
    } catch (err) {
      setConfigError(err instanceof Error ? err.message : "Falha ao salvar configurações da loja");
    } finally {
      setConfigSaving(false);
    }
  };

  const toggleDay = (index: number) => {
    setDays(prev => prev.map((d, i) => (i === index ? { ...d, active: !d.active } : d)));
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
        <p className="loj-subtitle">Atendimento, contato e aparência do site público</p>
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
                    type="button"
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
                  onChange={e => setOpenTime(e.target.value)}
                />
              </div>
              <div className="loj-field">
                <span className="loj-field-label">Fecha</span>
                <input
                  type="time"
                  className="loj-input"
                  value={closeTime}
                  onChange={e => setCloseTime(e.target.value)}
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
                onChange={e => setLocalName(e.target.value)}
              />
            </div>
            <div className="loj-field">
              <span className="loj-field-label">Endereço</span>
              <input
                type="text"
                className="loj-input"
                value={address}
                onChange={e => setAddress(e.target.value)}
              />
            </div>
            <div className="loj-field">
              <span className="loj-field-label">Link do Google Maps</span>
              <input
                type="text"
                className="loj-input loj-input--link"
                value={mapsLink}
                onChange={e => setMapsLink(e.target.value)}
              />
            </div>
          </section>

          {/* Entregas */}
          <section className="loj-panel">
            <h2 className="loj-panel-title">Entregas</h2>
            <div className="loj-delivery-row">
              <button
                type="button"
                className={`loj-delivery-pill ${deliveryStatus === "soon" ? "loj-delivery-pill--active" : ""}`}
                onClick={() => setDeliveryStatus("soon")}
              >
                Em breve
              </button>
              <button
                type="button"
                className={`loj-delivery-pill ${deliveryStatus === "available" ? "loj-delivery-pill--active" : ""}`}
                onClick={() => setDeliveryStatus("available")}
              >
                Disponíveis
              </button>
              <button
                type="button"
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
          <LojaPreviewPanel
            localName={localName}
            address={address}
            scheduleText={scheduleText}
            deliveryLabel={deliveryLabel}
            whatsapp={whatsapp}
          />

          {/* Contato */}
          <section className="loj-panel">
            <h2 className="loj-panel-title">Contato</h2>
            <div className="loj-field">
              <span className="loj-field-label">WhatsApp</span>
              <input
                type="text"
                className="loj-input"
                value={whatsapp}
                onChange={e => setWhatsapp(e.target.value)}
              />
            </div>
            <div className="loj-field">
              <span className="loj-field-label">Mensagem padrão</span>
              <textarea
                className="loj-textarea"
                value={defaultMessage}
                onChange={e => setDefaultMessage(e.target.value)}
                rows={3}
              />
            </div>
          </section>

          {/* Imagens da página inicial */}
          <ImagensPaginaInicialPanel />
        </div>
      </div>

      {/* ── Save bar ── */}
      <div className="loj-save-bar">
        {configError && <p className="loj-diag-error">{configError}</p>}
        {configSaved && <p className="loj-diag-success">Alterações salvas e publicadas.</p>}
        <button
          type="button"
          className="loj-btn-save"
          onClick={salvarConfiguracoes}
          disabled={configSaving || configLoading}
        >
          {configLoading ? "Carregando..." : configSaving ? "Salvando..." : "Salvar alterações"}
        </button>
      </div>

      {/* ── Diagnósticos permanentes ── */}
      <section className="loj-diag-panel">
        <div className="loj-diag-header">
          <div>
            <h2 className="loj-diag-title">Diagnósticos permanentes</h2>
            <p className="loj-diag-subtitle">Testes operacionais e utilitários da loja</p>
          </div>
          <span className="loj-badge-owner">OWNER</span>
        </div>

        <div className="loj-diag-grid">
          {/* Pix */}
          <PixDiagnosticoPanel />

          {/* Pedido teste */}
          <PushTestePanel />
        </div>
      </section>
    </main>
  );
}
