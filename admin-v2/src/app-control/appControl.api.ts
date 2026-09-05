import { z } from "zod";
import { requestJson } from "../shared/apiClient";

const AppConfigSchema = z.object({
  schema_version: z.number().int(),
  revision: z.number().int(),
  min_app_version_code: z.number().int(),
  poll_seconds: z.number().int(),
  theme: z.enum(["system", "light", "dark"]),
  maintenance: z.object({
    enabled: z.boolean(),
    eyebrow: z.string(),
    title: z.string(),
    message: z.string()
  }),
  update: z.object({
    eyebrow: z.string(),
    title: z.string(),
    message: z.string(),
    url: z.string()
  }),
  navigation: z.object({
    dashboard: z.boolean(),
    products: z.boolean(),
    orders: z.boolean(),
    admins: z.boolean(),
    store: z.boolean()
  }),
  dashboard_banner: z.object({
    enabled: z.boolean(),
    eyebrow: z.string(),
    title: z.string(),
    message: z.string(),
    tone: z.enum(["accent", "success", "warning", "neutral"])
  }),
  features: z.object({
    dashboard_metrics: z.boolean(),
    dashboard_flavors: z.boolean(),
    dashboard_receivables: z.boolean(),
    dashboard_recent_orders: z.boolean(),
    dashboard_attention: z.boolean(),
    orders_manual_create: z.boolean(),
    paid_order_notifications: z.boolean()
  }),
  dashboard_section_order: z.array(
    z.enum(["metrics", "flavors", "receivables", "recent_orders", "attention"])
  )
});

const HistorySchema = z.object({
  revision: z.number().int(),
  atualizado_em: z.string().nullable().optional(),
  atualizado_por: z.number().int().nullable(),
  atualizado_por_nome: z.string().nullable(),
  config: AppConfigSchema
});

const PayloadSchema = z.object({
  config: AppConfigSchema,
  history: z.array(HistorySchema)
});

const SavePayloadSchema = z.object({
  ok: z.literal(true),
  config: AppConfigSchema,
  history: z.array(HistorySchema)
});

export type AppRemoteConfig = z.infer<typeof AppConfigSchema>;
export type AppConfigHistoryEntry = z.infer<typeof HistorySchema>;
export type AppControlPayload = z.infer<typeof PayloadSchema>;

export async function loadAppControl(): Promise<AppControlPayload> {
  return PayloadSchema.parse(
    await requestJson(
      "/api/admin/app-config",
      {},
      "Não foi possível carregar a configuração do aplicativo."
    )
  );
}

export async function saveAppControl(config: AppRemoteConfig): Promise<AppControlPayload> {
  const payload = SavePayloadSchema.parse(
    await requestJson(
      "/api/admin/app-config",
      { method: "PUT", body: JSON.stringify(config) },
      "Não foi possível salvar a configuração do aplicativo."
    )
  );
  return { config: payload.config, history: payload.history };
}

export async function restoreAppControl(revision: number): Promise<AppControlPayload> {
  const payload = SavePayloadSchema.parse(
    await requestJson(
      "/api/admin/app-config",
      { method: "POST", body: JSON.stringify({ restore_revision: revision }) },
      "Não foi possível restaurar a configuração selecionada."
    )
  );
  return { config: payload.config, history: payload.history };
}
