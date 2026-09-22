/// <reference types="@cloudflare/workers-types" />

import { requireUser, sameOrigin } from "../lib/auth";
import {
  formatWhatsappBr,
  isValidWhatsappBr,
  normalizeWhatsappBr,
} from "../../shared/whatsapp";

interface Env {
  DB: D1Database;
}

type DeliveryStatus = "soon" | "available" | "unavailable";

interface ConfigInput {
  days?: { label?: string; active?: boolean }[];
  openTime?: string;
  closeTime?: string;
  localName?: string;
  address?: string;
  mapsLink?: string;
  deliveryStatus?: DeliveryStatus;
  whatsapp?: string;
  defaultMessage?: string;
}

const DAY_LABELS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"] as const;
const DAY_KEYS = ["dia_seg", "dia_ter", "dia_qua", "dia_qui", "dia_sex", "dia_sab", "dia_dom"] as const;
const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const DELIVERY = new Set<DeliveryStatus>(["soon", "available", "unavailable"]);

const DEFAULTS = {
  days: [false, true, true, true, true, true, false],
  openTime: "09:00",
  closeTime: "20:00",
  localName: "Temponi Concept",
  address: "Rua Lais Bertoni Pereira 182 Cambuí Sala 07",
  mapsLink: "https://maps.google.com/?q=Temponi+Concept",
  deliveryStatus: "unavailable" as DeliveryStatus,
  whatsapp: "(33) 99128-5907",
  defaultMessage: "Olá! Gostaria de fazer um pedido de bolo.",
};

function deliveryFromDb(value: string | undefined): DeliveryStatus {
  if (value === "DISPONIVEL" || value === "available") return "available";
  if (value === "EM_BREVE" || value === "soon") return "soon";
  return "unavailable";
}

function deliveryToDb(value: DeliveryStatus): string {
  if (value === "available") return "DISPONIVEL";
  if (value === "soon") return "EM_BREVE";
  return "INDISPONIVEL";
}

function whatsappFromDb(value: string | undefined): string {
  if (!value) return DEFAULTS.whatsapp;
  let digits = value.replace(/\D/g, "");
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) {
    digits = digits.slice(2);
  }
  return formatWhatsappBr(digits) || DEFAULTS.whatsapp;
}

async function readConfig(db: D1Database) {
  const { results } = await db
    .prepare("SELECT chave, valor FROM configuracoes_loja")
    .all<{ chave: string; valor: string }>();

  const values = Object.fromEntries(
    results.map((row) => [row.chave, row.valor]),
  ) as Record<string, string>;

  return {
    days: DAY_LABELS.map((label, index) => ({
      label,
      active:
        values[DAY_KEYS[index]] === undefined
          ? DEFAULTS.days[index]
          : values[DAY_KEYS[index]] === "1",
    })),
    openTime: values.horario_abre || DEFAULTS.openTime,
    closeTime: values.horario_fecha || DEFAULTS.closeTime,
    localName: values.local_retirada || DEFAULTS.localName,
    address: values.endereco || DEFAULTS.address,
    mapsLink: values.maps_link ?? DEFAULTS.mapsLink,
    deliveryStatus: deliveryFromDb(values.entregas_status),
    whatsapp: whatsappFromDb(values.whatsapp),
    defaultMessage: values.mensagem_whatsapp ?? DEFAULTS.defaultMessage,
  };
}

function validate(body: ConfigInput) {
  if (!Array.isArray(body.days) || body.days.length !== DAY_LABELS.length) {
    return "Dias de funcionamento inválidos";
  }
  for (let i = 0; i < DAY_LABELS.length; i += 1) {
    if (
      body.days[i]?.label !== DAY_LABELS[i] ||
      typeof body.days[i]?.active !== "boolean"
    ) {
      return "Dias de funcionamento inválidos";
    }
  }
  if (!body.openTime || !TIME_RE.test(body.openTime)) {
    return "Horário de abertura inválido";
  }
  if (!body.closeTime || !TIME_RE.test(body.closeTime)) {
    return "Horário de fechamento inválido";
  }
  if (!body.localName?.trim() || body.localName.trim().length > 120) {
    return "Nome do local inválido";
  }
  if (!body.address?.trim() || body.address.trim().length > 300) {
    return "Endereço inválido";
  }
  if ((body.mapsLink ?? "").length > 1000) {
    return "Link do Google Maps muito longo";
  }
  if (body.mapsLink) {
    try {
      const url = new URL(body.mapsLink);
      if (url.protocol !== "https:" && url.protocol !== "http:") {
        return "Link do Google Maps inválido";
      }
    } catch {
      return "Link do Google Maps inválido";
    }
  }
  if (!body.deliveryStatus || !DELIVERY.has(body.deliveryStatus)) {
    return "Status de entrega inválido";
  }
  if (!body.whatsapp || !isValidWhatsappBr(body.whatsapp)) {
    return "WhatsApp inválido";
  }
  if ((body.defaultMessage ?? "").length > 500) {
    return "Mensagem padrão muito longa";
  }
  return null;
}

function upsertConfig(db: D1Database, chave: string, valor: string) {
  return db
    .prepare(
      `INSERT INTO configuracoes_loja (chave, valor, atualizado_em)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(chave) DO UPDATE
       SET valor = excluded.valor, atualizado_em = CURRENT_TIMESTAMP`,
    )
    .bind(chave, valor);
}

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  try {
    return Response.json(
      { config: await readConfig(env.DB) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    console.error("Erro ao carregar configurações públicas da loja", err);
    return Response.json(
      { error: "Erro interno ao carregar configurações" },
      { status: 500 },
    );
  }
};

export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  if (!sameOrigin(request)) {
    return Response.json({ error: "Origem inválida" }, { status: 403 });
  }

  const auth = await requireUser(env.DB, request);
  if ("error" in auth) return auth.error;

  let body: ConfigInput;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }

  const error = validate(body);
  if (error) return Response.json({ error }, { status: 400 });

  try {
    const whatsappLocal = normalizeWhatsappBr(body.whatsapp!);
    const scheduleText = `${body.days!.filter((day) => day.active).map((day) => day.label).join(", ")}: ${body.openTime} às ${body.closeTime}`;

    await env.DB.batch([
      ...DAY_KEYS.map((key, index) =>
        upsertConfig(env.DB, key, body.days![index].active ? "1" : "0"),
      ),
      upsertConfig(env.DB, "horario_abre", body.openTime!),
      upsertConfig(env.DB, "horario_fecha", body.closeTime!),
      upsertConfig(env.DB, "horario_atendimento", scheduleText),
      upsertConfig(env.DB, "local_retirada", body.localName!.trim()),
      upsertConfig(env.DB, "endereco", body.address!.trim()),
      upsertConfig(env.DB, "maps_link", body.mapsLink?.trim() ?? ""),
      upsertConfig(env.DB, "entregas_status", deliveryToDb(body.deliveryStatus!)),
      upsertConfig(env.DB, "whatsapp", `55${whatsappLocal}`),
      upsertConfig(env.DB, "mensagem_whatsapp", body.defaultMessage?.trim() ?? ""),
    ]);

    return Response.json({ config: await readConfig(env.DB) });
  } catch (err) {
    console.error("Erro ao salvar configurações da loja", err);
    return Response.json(
      { error: "Erro interno ao salvar configurações" },
      { status: 500 },
    );
  }
};
