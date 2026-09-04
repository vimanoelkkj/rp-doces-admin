import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import type { AuthSession } from "../auth/AuthGate";
import { AdminShell, type AdminV2Page } from "../layout/AdminShell";
import { getStoreConfig, removeSiteImage, updateStoreConfig, uploadSiteImage } from "./store.api";
import {
  DELIVERY_LABELS,
  STORE_DAYS,
  imageUrl,
  parseLegacySchedule,
  phoneDisplay,
  scheduleText,
  type DeliveryStatus,
  type StoreDay
} from "./store.model";
import type { SiteImageSlot, StoreConfig, StoreFormState } from "./store.types";
import styles from "./StorePage.module.css";

type Props = {
  session: AuthSession;
  onNavigate: (page: AdminV2Page) => void;
};

type ImageState = {
  key: string;
  url: string;
  busy: boolean;
  status: string;
  error: boolean;
};

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const IMAGE_SLOTS: Array<{ slot: SiteImageSlot; title: string; help: string }> = [
  {
    slot: "hero",
    title: "Imagem principal",
    help: "Foto grande ao lado do título da página inicial."
  },
  {
    slot: "about",
    title: "Nossa história",
    help: "Foto exibida na seção “Uma nova doçura dentro do salão”."
  }
];

let storeCache: StoreConfig | null = null;

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function configToForm(config: StoreConfig): StoreFormState {
  const legacy = parseLegacySchedule(config.horario_atendimento || "Seg a sáb, 10h às 19h");
  const explicitDays = config.horario_dias
    .split(",")
    .filter((day): day is StoreDay => STORE_DAYS.some(([key]) => key === day));

  return {
    whatsapp: phoneDisplay(config.whatsapp),
    local_retirada: config.local_retirada,
    endereco: config.endereco,
    maps_url: config.maps_url,
    entregas_status: config.entregas_status,
    horario_dias: explicitDays.length ? explicitDays : legacy.days,
    horario_abre: config.horario_abre || legacy.open || "10:00",
    horario_fecha: config.horario_fecha || legacy.close || "19:00",
    mensagem_whatsapp: config.mensagem_whatsapp
  };
}

function emptyForm(): StoreFormState {
  return {
    whatsapp: "",
    local_retirada: "",
    endereco: "",
    maps_url: "",
    entregas_status: "EM_BREVE",
    horario_dias: ["seg", "ter", "qua", "qui", "sex", "sab"],
    horario_abre: "10:00",
    horario_fecha: "19:00",
    mensagem_whatsapp: ""
  };
}

function initialImages(config: StoreConfig): Record<SiteImageSlot, ImageState> {
  return {
    hero: {
      key: config.home_hero_image_key,
      url: imageUrl(config.home_hero_image_key),
      busy: false,
      status: "JPG, PNG ou WebP · até 5 MB",
      error: false
    },
    about: {
      key: config.home_about_image_key,
      url: imageUrl(config.home_about_image_key),
      busy: false,
      status: "JPG, PNG ou WebP · até 5 MB",
      error: false
    }
  };
}

export function StorePage({ session, onNavigate }: Props) {
  const [form, setForm] = useState<StoreFormState>(() => storeCache ? configToForm(storeCache) : emptyForm());
  const [images, setImages] = useState<Record<SiteImageSlot, ImageState> | null>(() => storeCache ? initialImages(storeCache) : null);
  const [loading, setLoading] = useState(() => storeCache === null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string>("");
  const [saveError, setSaveError] = useState(false);

  async function load() {
    const foreground = storeCache === null;
    if (foreground) setLoading(true);
    setLoadError(null);
    try {
      const config = await getStoreConfig();
      storeCache = config;
      setForm(configToForm(config));
      setImages(initialImages(config));
    } catch (error) {
      setLoadError(errorMessage(error, "Não foi possível carregar as configurações da loja."));
    } finally {
      if (foreground) setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const currentSchedule = useMemo(
    () => scheduleText(form.horario_dias, form.horario_abre, form.horario_fecha),
    [form.horario_dias, form.horario_abre, form.horario_fecha]
  );

  function patch<K extends keyof StoreFormState>(key: K, value: StoreFormState[K]) {
    setForm(current => ({ ...current, [key]: value }));
    setSaveStatus("");
    setSaveError(false);
  }

  function toggleDay(day: StoreDay) {
    patch(
      "horario_dias",
      form.horario_dias.includes(day)
        ? form.horario_dias.filter(item => item !== day)
        : STORE_DAYS.map(([key]) => key).filter(key => key === day || form.horario_dias.includes(key))
    );
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setSaveStatus("Salvando…");
    setSaveError(false);
    try {
      await updateStoreConfig(form, currentSchedule);
      storeCache = null;
      setSaveStatus("Alterações salvas ✓");
      window.dispatchEvent(
        new CustomEvent("rp-admin-data-changed", { detail: { pages: ["loja", "dashboard"] } })
      );
    } catch (error) {
      setSaveStatus(errorMessage(error, "Não foi possível salvar as alterações."));
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  }

  function setImageState(slot: SiteImageSlot, patchValue: Partial<ImageState>) {
    setImages(current =>
      current
        ? { ...current, [slot]: { ...current[slot], ...patchValue } }
        : current
    );
  }

  async function handleImageChange(slot: SiteImageSlot, event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;

    if (!ACCEPTED_IMAGE_TYPES.has(file.type) || file.size < 1 || file.size > MAX_IMAGE_BYTES) {
      setImageState(slot, {
        status: "Use JPG, PNG ou WebP com no máximo 5 MB.",
        error: true
      });
      input.value = "";
      return;
    }

    setImageState(slot, { busy: true, status: "Enviando…", error: false });
    try {
      const result = await uploadSiteImage(slot, file);
      storeCache = null;
      setImageState(slot, {
        key: result.image_key,
        url: result.image_url || imageUrl(result.image_key),
        busy: false,
        status: "Foto atualizada ✓",
        error: false
      });
    } catch (error) {
      setImageState(slot, {
        busy: false,
        status: errorMessage(error, "Falha ao enviar a foto."),
        error: true
      });
    } finally {
      input.value = "";
    }
  }

  async function handleImageRemove(slot: SiteImageSlot) {
    const state = images?.[slot];
    if (!state?.key || state.busy) return;
    setImageState(slot, { busy: true, status: "Removendo…", error: false });
    try {
      await removeSiteImage(slot);
      storeCache = null;
      setImageState(slot, {
        key: "",
        url: "",
        busy: false,
        status: "Foto removida ✓",
        error: false
      });
    } catch (error) {
      setImageState(slot, {
        busy: false,
        status: errorMessage(error, "Falha ao remover a foto."),
        error: true
      });
    }
  }

  return (
    <AdminShell
      session={session}
      activePage="loja"
      title="Loja"
      subtitle="Atendimento, contato e aparência do site público"
      onNavigate={onNavigate}
    >
      {loading ? <div className={styles.stateCard}>Carregando configurações da loja…</div> : null}
      {!loading && loadError ? (
        <div className={`${styles.stateCard} ${styles.stateError}`} role="alert">
          <strong>Não foi possível carregar a loja.</strong>
          <span>{loadError}</span>
          <button type="button" onClick={() => void load()}>Tentar novamente</button>
        </div>
      ) : null}

      {!loading && !loadError ? (
        <form className={styles.view} onSubmit={event => void handleSave(event)}>
          <section className={styles.toolbar}>
            <div>
              <p className={styles.kicker}>Operação da loja</p>
              <h2>Configurações públicas</h2>
              <p>Atualize atendimento, retirada, entregas, contato e imagens exibidos no site.</p>
            </div>
            <div className={styles.toolbarActions}>
              {saveStatus ? (
                <span className={saveError ? styles.saveError : styles.saveStatus} role="status">
                  {saveStatus}
                </span>
              ) : null}
              <button className={styles.primaryButton} type="submit" disabled={saving}>
                {saving ? "Salvando…" : "Salvar alterações"}
              </button>
            </div>
          </section>

          <div className={styles.grid}>
            <section className={`${styles.card} ${styles.scheduleCard}`}>
              <div className={styles.cardHead}>
                <span className={styles.icon} aria-hidden="true">◷</span>
                <div><h3>Atendimento</h3><p>Dias e horário em que a R&amp;P atende.</p></div>
              </div>
              <div className={styles.days} role="group" aria-label="Dias de atendimento">
                {STORE_DAYS.map(([key, label]) => {
                  const active = form.horario_dias.includes(key);
                  return (
                    <button
                      key={key}
                      className={`${styles.dayButton} ${active ? styles.activeChoice : ""}`}
                      type="button"
                      aria-pressed={active}
                      onClick={() => toggleDay(key)}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <div className={styles.timeRow}>
                <label className={styles.field}>
                  <span>Abre</span>
                  <input type="time" step="1800" value={form.horario_abre} onChange={event => patch("horario_abre", event.target.value)} />
                </label>
                <label className={styles.field}>
                  <span>Fecha</span>
                  <input type="time" step="1800" value={form.horario_fecha} onChange={event => patch("horario_fecha", event.target.value)} />
                </label>
              </div>
              <div className={styles.inlinePreview}>
                <small>Como aparece no site</small>
                <strong>{currentSchedule}</strong>
              </div>
            </section>

            <section className={styles.card}>
              <div className={styles.cardHead}>
                <span className={styles.icon} aria-hidden="true">⌖</span>
                <div><h3>Retirada</h3><p>Local e endereço mostrados ao cliente.</p></div>
              </div>
              <label className={styles.field}>
                <span>Nome do local</span>
                <input value={form.local_retirada} onChange={event => patch("local_retirada", event.target.value)} placeholder="Ex.: Temponi Concept" />
              </label>
              <label className={styles.field}>
                <span>Endereço</span>
                <input value={form.endereco} onChange={event => patch("endereco", event.target.value)} placeholder="Rua, número, bairro e cidade" />
              </label>
              <label className={styles.field}>
                <span>Link do Google Maps</span>
                <input type="url" value={form.maps_url} onChange={event => patch("maps_url", event.target.value)} placeholder="https://maps.google.com/..." />
              </label>
            </section>

            <section className={styles.card}>
              <div className={styles.cardHead}>
                <span className={styles.icon} aria-hidden="true">↗</span>
                <div><h3>Entregas</h3><p>Defina o estado exibido no cardápio.</p></div>
              </div>
              <div className={styles.choices}>
                {(Object.keys(DELIVERY_LABELS) as DeliveryStatus[]).map(value => (
                  <button
                    key={value}
                    className={`${styles.choiceButton} ${form.entregas_status === value ? styles.activeChoice : ""}`}
                    type="button"
                    aria-pressed={form.entregas_status === value}
                    onClick={() => patch("entregas_status", value)}
                  >
                    {DELIVERY_LABELS[value]}
                  </button>
                ))}
              </div>
              <div className={styles.helpBox}>
                <strong>{DELIVERY_LABELS[form.entregas_status]}</strong>
                <span>Essa alteração afeta a comunicação pública sobre entregas.</span>
              </div>
            </section>

            <section className={styles.card}>
              <div className={styles.cardHead}>
                <span className={styles.icon} aria-hidden="true">✆</span>
                <div><h3>Contato</h3><p>WhatsApp e mensagem padrão do pedido.</p></div>
              </div>
              <label className={styles.field}>
                <span>WhatsApp</span>
                <input
                  inputMode="tel"
                  autoComplete="tel"
                  value={form.whatsapp}
                  onChange={event => patch("whatsapp", phoneDisplay(event.target.value))}
                  placeholder="(31) 99999-9999"
                />
              </label>
              <label className={styles.field}>
                <span>Mensagem padrão</span>
                <textarea
                  rows={4}
                  value={form.mensagem_whatsapp}
                  onChange={event => patch("mensagem_whatsapp", event.target.value)}
                  placeholder="Mensagem usada ao iniciar o contato pelo WhatsApp"
                />
              </label>
            </section>

            <section className={`${styles.card} ${styles.previewCard}`}>
              <div className={styles.cardHead}>
                <span className={styles.icon} aria-hidden="true">◉</span>
                <div><h3>Prévia da loja</h3><p>Resumo do que o cliente encontra no site.</p></div>
              </div>
              <div className={styles.publicPreview}>
                <PreviewRow icon="⌖" label="Retirada" value={form.local_retirada.trim() || "Local não informado"} />
                <PreviewRow icon="⌂" label="Endereço" value={form.endereco.trim() || "Endereço não informado"} />
                <PreviewRow icon="◷" label="Atendimento" value={currentSchedule} />
                <PreviewRow icon="↗" label="Entregas" value={DELIVERY_LABELS[form.entregas_status]} />
                <PreviewRow icon="✆" label="WhatsApp" value={form.whatsapp.trim() || "WhatsApp não informado"} />
              </div>
              <p className={styles.previewNote}>
                A prévia acompanha suas alterações antes de salvar. O site público só recebe os novos valores depois de clicar em “Salvar alterações”.
              </p>
            </section>

            <section className={`${styles.card} ${styles.imagesCard}`}>
              <div className={styles.cardHead}>
                <span className={styles.icon} aria-hidden="true">▣</span>
                <div><h3>Imagens da página inicial</h3><p>Gerencie as duas fotos principais da home.</p></div>
              </div>
              <div className={styles.imageGrid}>
                {images ? IMAGE_SLOTS.map(item => (
                  <ImageSlot
                    key={item.slot}
                    {...item}
                    state={images[item.slot]}
                    onChange={event => void handleImageChange(item.slot, event)}
                    onRemove={() => void handleImageRemove(item.slot)}
                  />
                )) : null}
              </div>
            </section>
          </div>
        </form>
      ) : null}
    </AdminShell>
  );
}

function PreviewRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className={styles.previewRow}>
      <span aria-hidden="true">{icon}</span>
      <div><small>{label}</small><strong>{value}</strong></div>
    </div>
  );
}

function ImageSlot({
  title,
  help,
  state,
  onChange,
  onRemove
}: {
  slot: SiteImageSlot;
  title: string;
  help: string;
  state: ImageState;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onRemove: () => void;
}) {
  return (
    <article className={styles.imageSlot}>
      <div className={styles.imagePreview}>
        {state.url ? <img src={state.url} alt={`Prévia de ${title}`} /> : <span>Sem foto</span>}
      </div>
      <div className={styles.imageBody}>
        <div><strong>{title}</strong><p>{help}</p></div>
        <div className={styles.imageActions}>
          <label className={`${styles.secondaryButton} ${state.busy ? styles.disabledControl : ""}`}>
            {state.busy ? "Processando…" : "Escolher foto"}
            <input type="file" accept="image/jpeg,image/png,image/webp" hidden disabled={state.busy} onChange={onChange} />
          </label>
          {state.key ? (
            <button className={styles.secondaryButton} type="button" disabled={state.busy} onClick={onRemove}>
              Remover foto
            </button>
          ) : null}
        </div>
        <small className={state.error ? styles.imageError : styles.imageStatus}>{state.status}</small>
      </div>
    </article>
  );
}
