import { z } from "zod";
import { requestJson } from "../shared/apiClient";
import { DELIVERY_LABELS, type DeliveryStatus } from "./store.model";
import type { SiteImageResult, SiteImageSlot, StoreConfig, StoreFormState } from "./store.types";

const DeliverySchema = z.enum(["EM_BREVE", "DISPONIVEL", "INDISPONIVEL"]);

const StoreConfigSchema = z
  .object({
    whatsapp: z.string().optional().default(""),
    local_retirada: z.string().optional().default(""),
    endereco: z.string().optional().default(""),
    maps_url: z.string().optional().default(""),
    entregas_status: z.string().optional().default("EM_BREVE"),
    horario_atendimento: z.string().optional().default(""),
    horario_dias: z.string().optional().default(""),
    horario_abre: z.string().optional().default(""),
    horario_fecha: z.string().optional().default(""),
    mensagem_whatsapp: z.string().optional().default(""),
    home_hero_image_key: z.string().optional().default(""),
    home_about_image_key: z.string().optional().default("")
  })
  .passthrough();

const OkSchema = z.object({ ok: z.literal(true) });
const SiteImageSchema = z.object({
  ok: z.literal(true),
  image_key: z.string(),
  image_url: z.string()
});

function normalizedDelivery(value: string): DeliveryStatus {
  return value in DELIVERY_LABELS && DeliverySchema.safeParse(value).success
    ? (value as DeliveryStatus)
    : "EM_BREVE";
}

export async function getStoreConfig(): Promise<StoreConfig> {
  const parsed = StoreConfigSchema.parse(
    await requestJson("/api/admin/config", {}, "Não foi possível carregar as configurações da loja.")
  );

  return {
    whatsapp: parsed.whatsapp,
    local_retirada: parsed.local_retirada,
    endereco: parsed.endereco,
    maps_url: parsed.maps_url,
    entregas_status: normalizedDelivery(parsed.entregas_status),
    horario_atendimento: parsed.horario_atendimento,
    horario_dias: parsed.horario_dias,
    horario_abre: parsed.horario_abre,
    horario_fecha: parsed.horario_fecha,
    mensagem_whatsapp: parsed.mensagem_whatsapp,
    home_hero_image_key: parsed.home_hero_image_key,
    home_about_image_key: parsed.home_about_image_key
  };
}

export async function updateStoreConfig(input: StoreFormState, horarioAtendimento: string): Promise<void> {
  OkSchema.parse(
    await requestJson(
      "/api/admin/config",
      {
        method: "PUT",
        body: JSON.stringify({
          local_retirada: input.local_retirada.trim(),
          endereco: input.endereco.trim(),
          maps_url: input.maps_url.trim(),
          whatsapp: input.whatsapp.trim(),
          mensagem_whatsapp: input.mensagem_whatsapp.trim(),
          horario_dias: input.horario_dias.join(","),
          horario_abre: input.horario_abre || "10:00",
          horario_fecha: input.horario_fecha || "19:00",
          horario_atendimento: horarioAtendimento,
          entregas_status: input.entregas_status
        })
      },
      "Não foi possível salvar as configurações da loja."
    )
  );
}

export async function uploadSiteImage(slot: SiteImageSlot, file: File): Promise<SiteImageResult> {
  const form = new FormData();
  form.set("image", file);
  const parsed = SiteImageSchema.parse(
    await requestJson(
      `/api/admin/site-images/${slot}`,
      { method: "POST", body: form },
      "Não foi possível enviar a imagem."
    )
  );
  return { image_key: parsed.image_key, image_url: parsed.image_url };
}

export async function removeSiteImage(slot: SiteImageSlot): Promise<void> {
  OkSchema.parse(
    await requestJson(
      `/api/admin/site-images/${slot}`,
      { method: "DELETE" },
      "Não foi possível remover a imagem."
    )
  );
}
