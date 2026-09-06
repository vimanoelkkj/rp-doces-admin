import { useEffect, useMemo, useState } from "react";
import {
  loadAppControl,
  restoreAppControl,
  saveAppControl,
  type AppConfigHistoryEntry,
  type AppRemoteConfig
} from "./appControl.api";
import styles from "./AppControlPage.module.css";

type Props = { active?: boolean };

const navLabels: Record<keyof AppRemoteConfig["navigation"], string> = {
  dashboard: "Dashboard",
  products: "Produtos",
  orders: "Pedidos",
  admins: "Administradores",
  store: "Loja"
};

const featureLabels: Record<keyof AppRemoteConfig["features"], { title: string; description: string }> = {
  dashboard_metrics: { title: "Métricas do dashboard", description: "Recebido, a receber, comandas e catálogo." },
  dashboard_flavors: { title: "Sabores mais vendidos", description: "Ranking dos últimos 30 dias." },
  dashboard_receivables: { title: "Valores a receber", description: "Clientes com saldo pendente." },
  dashboard_recent_orders: { title: "Pedidos recentes", description: "Últimos pedidos no dashboard." },
  dashboard_attention: { title: "Painel de atenção", description: "Alertas operacionais do dashboard." },
  orders_manual_create: { title: "Criar pedido manual", description: "Libera o botão Novo pedido no app." },
  paid_order_notifications: { title: "Notificações de pagamento", description: "Permite avisos nativos de novos pedidos pagos." }
};

const sectionLabels: Record<AppRemoteConfig["dashboard_section_order"][number], string> = {
  metrics: "Métricas",
  flavors: "Sabores",
  receivables: "Valores a receber",
  recent_orders: "Pedidos recentes",
  attention: "Atenção"
};

function cloneConfig(config: AppRemoteConfig): AppRemoteConfig {
  return JSON.parse(JSON.stringify(config)) as AppRemoteConfig;
}

function formatDate(value?: string | null): string {
  if (!value) return "Sistema";
  const date = new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(date);
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      className={`${styles.toggle} ${checked ? styles.toggleOn : ""}`}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}

export function AppControlPage({ active = true }: Props) {
  const [saved, setSaved] = useState<AppRemoteConfig | null>(null);
  const [draft, setDraft] = useState<AppRemoteConfig | null>(null);
  const [history, setHistory] = useState<AppConfigHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const dirty = useMemo(
    () => Boolean(saved && draft && JSON.stringify(saved) !== JSON.stringify(draft)),
    [draft, saved]
  );

  async function reload() {
    setLoading(true);
    setError("");
    try {
      const payload = await loadAppControl();
      setSaved(payload.config);
      setDraft(cloneConfig(payload.config));
      setHistory(payload.history);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar a configuração.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!active) return;
    void reload();
  }, [active]);

  function setMaintenance(value: boolean) {
    setDraft(current => current ? {
      ...current,
      maintenance: { ...current.maintenance, enabled: value }
    } : current);
  }

  function setBannerEnabled(value: boolean) {
    setDraft(current => current ? {
      ...current,
      dashboard_banner: { ...current.dashboard_banner, enabled: value }
    } : current);
  }

  function setNavigation(key: keyof AppRemoteConfig["navigation"], value: boolean) {
    setDraft(current => current ? {
      ...current,
      navigation: { ...current.navigation, [key]: value }
    } : current);
  }

  function setFeature(key: keyof AppRemoteConfig["features"], value: boolean) {
    setDraft(current => current ? {
      ...current,
      features: { ...current.features, [key]: value }
    } : current);
  }

  function moveSection(index: number, direction: -1 | 1) {
    setDraft(current => {
      if (!current) return current;
      const target = index + direction;
      if (target < 0 || target >= current.dashboard_section_order.length) return current;
      const next = cloneConfig(current);
      const order = next.dashboard_section_order;
      [order[index], order[target]] = [order[target], order[index]];
      return next;
    });
  }

  async function save() {
    if (!draft || !dirty || saving) return;
    setSaving(true);
    setError("");
    setStatus("");
    try {
      const payload = await saveAppControl(draft);
      setSaved(payload.config);
      setDraft(cloneConfig(payload.config));
      setHistory(payload.history);
      setStatus(`Revisão ${payload.config.revision} publicada. O app receberá a mudança automaticamente.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível salvar a configuração.");
    } finally {
      setSaving(false);
    }
  }

  async function restore(revision: number) {
    if (saving || !confirm(`Restaurar a configuração da revisão ${revision}? Uma nova revisão será criada.`)) return;
    setSaving(true);
    setError("");
    setStatus("");
    try {
      const payload = await restoreAppControl(revision);
      setSaved(payload.config);
      setDraft(cloneConfig(payload.config));
      setHistory(payload.history);
      setStatus(`Revisão ${revision} restaurada como revisão ${payload.config.revision}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível restaurar a revisão.");
    } finally {
      setSaving(false);
    }
  }

  if (loading && !draft) return <div className={styles.stateCard}>Carregando configuração do app…</div>;
  if (!draft) return <div className={`${styles.stateCard} ${styles.error}`}>{error || "Configuração indisponível."}</div>;

  return (
    <div className={styles.page}>
      <section className={`${styles.hero} ${draft.maintenance.enabled ? styles.heroDanger : ""}`}>
        <div>
          <span className={styles.eyebrow}>CENTRAL DE CONTROLE</span>
          <h2>{draft.maintenance.enabled ? "App em manutenção" : "App operacional"}</h2>
          <p>
            Revisão {saved?.revision ?? draft.revision}. Alterações salvas aqui chegam ao Android sem gerar um novo APK.
          </p>
        </div>
        <div className={styles.heroStatus}>
          <span className={draft.maintenance.enabled ? styles.dotDanger : styles.dotLive} />
          {draft.maintenance.enabled ? "Bloqueado" : "Online"}
        </div>
      </section>

      {status ? <div className={styles.success} role="status">{status}</div> : null}
      {error ? <div className={styles.errorBanner} role="alert">{error}</div> : null}

      <div className={styles.grid}>
        <section className={`${styles.panel} ${draft.maintenance.enabled ? styles.dangerPanel : ""}`}>
          <div className={styles.panelHeading}>
            <div>
              <span>SEGURANÇA OPERACIONAL</span>
              <h3>Modo manutenção</h3>
              <p>Substitui toda a interface do app por uma tela de indisponibilidade.</p>
            </div>
            <Toggle
              checked={draft.maintenance.enabled}
              onChange={setMaintenance}
              label="Modo manutenção"
            />
          </div>
          <div className={styles.fields}>
            <label><span>Rótulo</span><input value={draft.maintenance.eyebrow} maxLength={32} onChange={e => setDraft(c => c ? { ...c, maintenance: { ...c.maintenance, eyebrow: e.target.value } } : c)} /></label>
            <label><span>Título</span><input value={draft.maintenance.title} maxLength={90} onChange={e => setDraft(c => c ? { ...c, maintenance: { ...c.maintenance, title: e.target.value } } : c)} /></label>
            <label className={styles.full}><span>Mensagem</span><textarea value={draft.maintenance.message} maxLength={320} onChange={e => setDraft(c => c ? { ...c, maintenance: { ...c.maintenance, message: e.target.value } } : c)} /></label>
          </div>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeading}>
            <div><span>COMPORTAMENTO</span><h3>Tema e atualização</h3><p>Preferências globais e versão mínima aceita.</p></div>
          </div>
          <div className={styles.fields}>
            <label><span>Tema</span><select value={draft.theme} onChange={e => setDraft(c => c ? { ...c, theme: e.target.value as AppRemoteConfig["theme"] } : c)}><option value="system">Sistema</option><option value="light">Claro</option><option value="dark">Escuro</option></select></label>
            <label><span>Sincronização</span><select value={draft.poll_seconds} onChange={e => setDraft(c => c ? { ...c, poll_seconds: Number(e.target.value) } : c)}><option value={15}>15 segundos</option><option value={30}>30 segundos</option><option value={60}>1 minuto</option><option value={120}>2 minutos</option></select></label>
            <label><span>Versão mínima</span><input type="number" min={1} max={1000000} value={draft.min_app_version_code} onChange={e => setDraft(c => c ? { ...c, min_app_version_code: Math.max(1, Number(e.target.value) || 1) } : c)} /></label>
            <label><span>URL da atualização</span><input value={draft.update.url} maxLength={500} placeholder="https://…" onChange={e => setDraft(c => c ? { ...c, update: { ...c.update, url: e.target.value } } : c)} /></label>
            <label><span>Título de atualização</span><input value={draft.update.title} maxLength={90} onChange={e => setDraft(c => c ? { ...c, update: { ...c.update, title: e.target.value } } : c)} /></label>
            <label className={styles.full}><span>Mensagem de atualização</span><textarea value={draft.update.message} maxLength={320} onChange={e => setDraft(c => c ? { ...c, update: { ...c.update, message: e.target.value } } : c)} /></label>
          </div>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeading}><div><span>NAVEGAÇÃO</span><h3>Abas disponíveis</h3><p>O app realoca o usuário se a aba atual for ocultada.</p></div></div>
          <div className={styles.switchList}>
            {(Object.keys(navLabels) as Array<keyof AppRemoteConfig["navigation"]>).map(key => (
              <div className={styles.switchRow} key={key}>
                <div><strong>{navLabels[key]}</strong><small>{key === "admins" ? "Contas e segurança da equipe" : "Visível na navegação principal"}</small></div>
                <Toggle checked={draft.navigation[key]} onChange={value => setNavigation(key, value)} label={navLabels[key]} />
              </div>
            ))}
          </div>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeading}><div><span>FEATURE FLAGS</span><h3>Recursos do app</h3><p>Kill switches e módulos do dashboard.</p></div></div>
          <div className={styles.switchList}>
            {(Object.keys(featureLabels) as Array<keyof AppRemoteConfig["features"]>).map(key => (
              <div className={styles.switchRow} key={key}>
                <div><strong>{featureLabels[key].title}</strong><small>{featureLabels[key].description}</small></div>
                <Toggle checked={draft.features[key]} onChange={value => setFeature(key, value)} label={featureLabels[key].title} />
              </div>
            ))}
          </div>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeading}>
            <div><span>DASHBOARD</span><h3>Banner remoto</h3><p>Mensagem que aparece no topo do dashboard nativo.</p></div>
            <Toggle checked={draft.dashboard_banner.enabled} onChange={setBannerEnabled} label="Banner do dashboard" />
          </div>
          <div className={styles.fields}>
            <label><span>Rótulo</span><input value={draft.dashboard_banner.eyebrow} maxLength={30} onChange={e => setDraft(c => c ? { ...c, dashboard_banner: { ...c.dashboard_banner, eyebrow: e.target.value } } : c)} /></label>
            <label><span>Tom</span><select value={draft.dashboard_banner.tone} onChange={e => setDraft(c => c ? { ...c, dashboard_banner: { ...c.dashboard_banner, tone: e.target.value as AppRemoteConfig["dashboard_banner"]["tone"] } } : c)}><option value="accent">Destaque</option><option value="success">Sucesso</option><option value="warning">Aviso</option><option value="neutral">Neutro</option></select></label>
            <label><span>Título</span><input value={draft.dashboard_banner.title} maxLength={80} onChange={e => setDraft(c => c ? { ...c, dashboard_banner: { ...c.dashboard_banner, title: e.target.value } } : c)} /></label>
            <label className={styles.full}><span>Mensagem</span><textarea value={draft.dashboard_banner.message} maxLength={280} onChange={e => setDraft(c => c ? { ...c, dashboard_banner: { ...c.dashboard_banner, message: e.target.value } } : c)} /></label>
          </div>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeading}><div><span>LAYOUT REMOTO</span><h3>Ordem do dashboard</h3><p>Reordene blocos sem recompilar o Android.</p></div></div>
          <div className={styles.orderList}>
            {draft.dashboard_section_order.map((section, index) => (
              <div className={styles.orderRow} key={section}>
                <span className={styles.orderIndex}>{index + 1}</span>
                <strong>{sectionLabels[section]}</strong>
                <div>
                  <button type="button" disabled={index === 0} onClick={() => moveSection(index, -1)} aria-label={`Subir ${sectionLabels[section]}`}>↑</button>
                  <button type="button" disabled={index === draft.dashboard_section_order.length - 1} onClick={() => moveSection(index, 1)} aria-label={`Descer ${sectionLabels[section]}`}>↓</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className={styles.historyPanel}>
        <div className={styles.panelHeading}><div><span>AUDITORIA</span><h3>Histórico de alterações</h3><p>Cada salvamento gera uma revisão imutável que pode ser restaurada.</p></div></div>
        <div className={styles.historyList}>
          {history.map(item => (
            <div className={styles.historyRow} key={item.revision}>
              <div className={styles.revision}>#{item.revision}</div>
              <div className={styles.historyInfo}><strong>{item.atualizado_por_nome || "Sistema"}</strong><span>{formatDate(item.atualizado_em)}</span></div>
              <div className={styles.historySummary}>{item.config.maintenance.enabled ? "Manutenção ativa" : "Operacional"} · {item.config.theme === "system" ? "Tema do sistema" : `Tema ${item.config.theme}`}</div>
              <button type="button" disabled={saving || item.revision === saved?.revision} onClick={() => void restore(item.revision)}>Restaurar</button>
            </div>
          ))}
        </div>
      </section>

      <div className={styles.actions}>
        <div><strong>{dirty ? "Alterações não publicadas" : "Tudo sincronizado"}</strong><span>{dirty ? "Revise os controles e publique quando estiver pronto." : `Revisão ${saved?.revision ?? draft.revision} ativa.`}</span></div>
        <button type="button" className={styles.secondary} disabled={!dirty || saving} onClick={() => saved && setDraft(cloneConfig(saved))}>Descartar</button>
        <button type="button" className={styles.primary} disabled={!dirty || saving} onClick={() => void save()}>{saving ? "Publicando…" : "Publicar no app"}</button>
      </div>
    </div>
  );
}
