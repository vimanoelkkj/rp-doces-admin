const ALLOWED_DASHBOARD_SECTIONS = [
  "metrics",
  "flavors",
  "receivables",
  "recent_orders",
  "attention"
];
const ALLOWED_THEMES = new Set(["system", "light", "dark"]);
const ALLOWED_BANNER_TONES = new Set(["accent", "success", "warning", "neutral"]);

export const DEFAULT_APP_CONFIG = {
  schema_version: 1,
  revision: 10,
  min_app_version_code: 1,
  poll_seconds: 30,
  theme: "system",
  maintenance: {
    enabled: false,
    eyebrow: "MANUTENÇÃO",
    title: "Voltamos em instantes",
    message: "O painel está temporariamente indisponível enquanto fazemos um ajuste."
  },
  update: {
    eyebrow: "ATUALIZAÇÃO NECESSÁRIA",
    title: "Atualize o R&P Doces",
    message: "Há uma versão mais recente do aplicativo disponível.",
    url: ""
  },
  navigation: {
    dashboard: true,
    products: true,
    orders: true,
    admins: true,
    store: true
  },
  dashboard_banner: {
    enabled: false,
    eyebrow: "AVISO",
    title: "",
    message: "",
    tone: "accent"
  },
  features: {
    dashboard_metrics: true,
    dashboard_flavors: true,
    dashboard_receivables: true,
    dashboard_recent_orders: true,
    dashboard_attention: true,
    orders_manual_create: true,
    paid_order_notifications: true
  },
  dashboard_section_order: [...ALLOWED_DASHBOARD_SECTIONS]
};

function asObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} inválido.`);
  }
  return value;
}

function text(value, max, label) {
  if (typeof value !== "string") throw new Error(`${label} inválido.`);
  if (value.length > max) throw new Error(`${label} excede ${max} caracteres.`);
  return value;
}

function bool(value, label) {
  if (typeof value !== "boolean") throw new Error(`${label} inválido.`);
  return value;
}

function integer(value, min, max, label) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${label} inválido.`);
  }
  return value;
}

export function normalizeAppConfig(input, forcedRevision = null) {
  const raw = asObject(input, "Configuração");
  const maintenance = asObject(raw.maintenance, "Manutenção");
  const update = asObject(raw.update, "Atualização");
  const navigation = asObject(raw.navigation, "Navegação");
  const banner = asObject(raw.dashboard_banner, "Banner do dashboard");
  const features = asObject(raw.features, "Recursos");

  const theme = text(raw.theme, 20, "Tema").trim().toLowerCase();
  if (!ALLOWED_THEMES.has(theme)) throw new Error("Tema inválido.");

  const tone = text(banner.tone, 20, "Tom do banner").trim().toLowerCase();
  if (!ALLOWED_BANNER_TONES.has(tone)) throw new Error("Tom do banner inválido.");

  const sectionOrder = Array.isArray(raw.dashboard_section_order)
    ? raw.dashboard_section_order.map(item => String(item).trim().toLowerCase())
    : [];
  if (
    sectionOrder.length !== ALLOWED_DASHBOARD_SECTIONS.length ||
    new Set(sectionOrder).size !== ALLOWED_DASHBOARD_SECTIONS.length ||
    sectionOrder.some(item => !ALLOWED_DASHBOARD_SECTIONS.includes(item))
  ) {
    throw new Error("Ordem das seções do dashboard inválida.");
  }

  const normalizedNavigation = {
    dashboard: bool(navigation.dashboard, "Navegação: dashboard"),
    products: bool(navigation.products, "Navegação: produtos"),
    orders: bool(navigation.orders, "Navegação: pedidos"),
    admins: bool(navigation.admins, "Navegação: administradores"),
    store: bool(navigation.store, "Navegação: loja")
  };
  if (!Object.values(normalizedNavigation).some(Boolean)) {
    throw new Error("Mantenha pelo menos uma seção da navegação visível.");
  }

  const updateUrl = text(update.url, 500, "URL de atualização").trim();
  if (updateUrl && !/^https?:\/\//i.test(updateUrl)) {
    throw new Error("A URL de atualização precisa usar http:// ou https://.");
  }

  return {
    schema_version: 1,
    revision: forcedRevision ?? integer(raw.revision, 1, Number.MAX_SAFE_INTEGER, "Revisão"),
    min_app_version_code: integer(raw.min_app_version_code, 1, 1_000_000, "Versão mínima"),
    poll_seconds: integer(raw.poll_seconds, 10, 300, "Intervalo de atualização"),
    theme,
    maintenance: {
      enabled: bool(maintenance.enabled, "Modo manutenção"),
      eyebrow: text(maintenance.eyebrow, 32, "Eyebrow da manutenção"),
      title: text(maintenance.title, 90, "Título da manutenção"),
      message: text(maintenance.message, 320, "Mensagem da manutenção")
    },
    update: {
      eyebrow: text(update.eyebrow, 32, "Eyebrow da atualização"),
      title: text(update.title, 90, "Título da atualização"),
      message: text(update.message, 320, "Mensagem da atualização"),
      url: updateUrl
    },
    navigation: normalizedNavigation,
    dashboard_banner: {
      enabled: bool(banner.enabled, "Banner do dashboard"),
      eyebrow: text(banner.eyebrow, 30, "Eyebrow do banner"),
      title: text(banner.title, 80, "Título do banner"),
      message: text(banner.message, 280, "Mensagem do banner"),
      tone
    },
    features: {
      dashboard_metrics: bool(features.dashboard_metrics, "Métricas do dashboard"),
      dashboard_flavors: bool(features.dashboard_flavors, "Sabores do dashboard"),
      dashboard_receivables: bool(features.dashboard_receivables, "Valores a receber"),
      dashboard_recent_orders: bool(features.dashboard_recent_orders, "Pedidos recentes"),
      dashboard_attention: bool(features.dashboard_attention, "Painel de atenção"),
      orders_manual_create: bool(features.orders_manual_create, "Criação manual de pedidos"),
      paid_order_notifications: bool(features.paid_order_notifications, "Notificações de pedidos pagos")
    },
    dashboard_section_order: sectionOrder
  };
}

export async function loadAppConfig(env) {
  try {
    const row = await env.DB.prepare(
      "SELECT revision, config_json, atualizado_por, atualizado_em FROM app_remote_config WHERE id = 1"
    ).first();
    if (!row?.config_json) return structuredClone(DEFAULT_APP_CONFIG);
    return normalizeAppConfig(JSON.parse(row.config_json), Number(row.revision));
  } catch {
    return structuredClone(DEFAULT_APP_CONFIG);
  }
}

export async function loadAppConfigHistory(env, limit = 20) {
  try {
    const rows = await env.DB.prepare(
      `SELECT h.revision, h.config_json, h.atualizado_em, h.atualizado_por,
              u.nome AS atualizado_por_nome
       FROM app_remote_config_history h
       LEFT JOIN usuarios_admin u ON u.id = h.atualizado_por
       ORDER BY h.revision DESC
       LIMIT ?`
    ).bind(Math.min(Math.max(Number(limit) || 20, 1), 50)).all();

    return (rows.results || []).map(row => ({
      revision: Number(row.revision),
      atualizado_em: row.atualizado_em,
      atualizado_por: row.atualizado_por == null ? null : Number(row.atualizado_por),
      atualizado_por_nome: row.atualizado_por_nome || null,
      config: normalizeAppConfig(JSON.parse(row.config_json), Number(row.revision))
    }));
  } catch {
    return [];
  }
}

export async function saveAppConfig(env, userId, input) {
  const current = await loadAppConfig(env);
  const nextRevision = current.revision + 1;
  const config = normalizeAppConfig({ ...input, revision: nextRevision }, nextRevision);
  const serialized = JSON.stringify(config);

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO app_remote_config (id, revision, config_json, atualizado_por, atualizado_em)
       VALUES (1, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(id) DO UPDATE SET
         revision = excluded.revision,
         config_json = excluded.config_json,
         atualizado_por = excluded.atualizado_por,
         atualizado_em = CURRENT_TIMESTAMP`
    ).bind(nextRevision, serialized, userId),
    env.DB.prepare(
      `INSERT INTO app_remote_config_history (revision, config_json, atualizado_por, atualizado_em)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)`
    ).bind(nextRevision, serialized, userId)
  ]);

  return config;
}

export async function restoreAppConfigRevision(env, userId, revision) {
  const row = await env.DB.prepare(
    "SELECT config_json FROM app_remote_config_history WHERE revision = ? LIMIT 1"
  ).bind(revision).first();
  if (!row?.config_json) throw new Error("Revisão não encontrada no histórico.");
  return saveAppConfig(env, userId, JSON.parse(row.config_json));
}
