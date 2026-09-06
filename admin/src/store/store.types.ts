import type { DeliveryStatus, StoreDay } from "./store.model";

export type StoreConfig = {
  whatsapp: string;
  local_retirada: string;
  endereco: string;
  maps_url: string;
  entregas_status: DeliveryStatus;
  horario_atendimento: string;
  horario_dias: string;
  horario_abre: string;
  horario_fecha: string;
  mensagem_whatsapp: string;
  home_hero_image_key: string;
  home_about_image_key: string;
};

export type StoreFormState = {
  whatsapp: string;
  local_retirada: string;
  endereco: string;
  maps_url: string;
  entregas_status: DeliveryStatus;
  horario_dias: StoreDay[];
  horario_abre: string;
  horario_fecha: string;
  mensagem_whatsapp: string;
};

export type SiteImageSlot = "hero" | "about";

export type SiteImageResult = {
  image_key: string;
  image_url: string;
};
