import { formatWhatsappBr, normalizeWhatsappBr } from "../../shared/whatsapp";

export interface StoreScheduleDay {
  label: string;
  active: boolean;
}

export type StoreDeliveryStatus = "soon" | "available" | "unavailable";

export interface StoreConfig {
  days: StoreScheduleDay[];
  openTime: string;
  closeTime: string;
  localName: string;
  address: string;
  mapsLink: string;
  deliveryStatus: StoreDeliveryStatus;
  whatsapp: string;
  defaultMessage: string;
}

export const DEFAULT_STORE_CONFIG: StoreConfig = {
  days: [
    { label: "Seg", active: false },
    { label: "Ter", active: true },
    { label: "Qua", active: true },
    { label: "Qui", active: true },
    { label: "Sex", active: true },
    { label: "Sáb", active: true },
    { label: "Dom", active: false },
  ],
  openTime: "09:00",
  closeTime: "20:00",
  localName: "Temponi Concept",
  address: "Rua Lais Bertoni Pereira 182 Cambuí Sala 07",
  mapsLink: "https://maps.google.com/?q=Temponi+Concept",
  deliveryStatus: "unavailable",
  whatsapp: "(33) 99128-5907",
  defaultMessage: "Olá! Gostaria de fazer um pedido de bolo.",
};

export function formatStoreSchedule(
  days: StoreScheduleDay[],
  openTime: string,
  closeTime: string,
): string {
  const activeDays = days.filter((day) => day.active);
  if (activeDays.length === 0) return "Fechado";
  const label =
    activeDays.length === 7
      ? "Todos os dias"
      : activeDays.length === 1
        ? activeDays[0].label
        : `${activeDays[0].label} a ${activeDays[activeDays.length - 1].label}`;
  return `${label}: ${openTime.replace(":", "h")} às ${closeTime.replace(":", "h")}`;
}

export function deliveryStatusLabel(status: StoreDeliveryStatus): string {
  if (status === "available") return "Entregas disponíveis";
  if (status === "soon") return "Entregas em breve";
  return "Entregas indisponíveis";
}

export function formatStoreWhatsapp(value: string): string {
  return formatWhatsappBr(value);
}

export function storeWhatsappHref(
  whatsapp: string,
  defaultMessage = "",
): string {
  const digits = normalizeWhatsappBr(whatsapp);
  const base = `https://wa.me/55${digits}`;
  const message = defaultMessage.trim();
  return message ? `${base}?text=${encodeURIComponent(message)}` : base;
}

export async function fetchStoreConfig(): Promise<StoreConfig> {
  const response = await fetch("/api/config", { cache: "no-store" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error ?? "Não foi possível carregar as configurações da loja");
  }
  if (!body || typeof body.config !== "object" || body.config === null) {
    return DEFAULT_STORE_CONFIG;
  }
  return body.config as StoreConfig;
}

export async function saveStoreConfig(config: StoreConfig): Promise<StoreConfig> {
  const response = await fetch("/api/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error ?? "Não foi possível salvar as configurações da loja");
  }
  return body.config as StoreConfig;
}
