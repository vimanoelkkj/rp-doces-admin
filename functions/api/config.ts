/// <reference types="@cloudflare/workers-types" />

import { requireUser, sameOrigin } from "../lib/auth";
import { isValidWhatsappBr } from "../../shared/whatsapp";

interface Env {
  DB: D1Database;
}

type DeliveryStatus = "soon" | "available" | "unavailable";

interface ConfigRow {
  seg: number;
  ter: number;
  qua: number;
  qui: number;
  sex: number;
  sab: number;
  dom: number;
  horario_abre: string;
  horario_fecha: string;
  local_nome: string;
  endereco: string;
  maps_link: string;
  entrega_status: DeliveryStatus;
  whatsapp: string;
  mensagem_padrao: string;
}

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
const TIME_RE = /^(?:[01]\\d|2[0-3]):[0-5]\\d$/;
const DELIVERY = new Set<DeliveryStatus>(["soon", "available", "unavailable"]);

function rowToConfig(row: ConfigRow) {
  const active = [row.seg, row.ter, row.qua, row.qui, row.sex, row.sab, row.dom];
  return {
    days: DAY_LABELS.map((label, index) => ({
      label,
      active: active[index] === 1,
    })),
    openTime: row.horario_abre,
    closeTime: row.horario_fecha,
    localName: row.local_nome,
    address: row.endereco,
    mapsLink: row.maps_link,
    deliveryStatus: row.entrega_status,
    whatsapp: row.whatsapp,
    defaultMessage: row.mensagem_padrao,
  };
}

async function readConfig(db: D1Database) {
  const row = await db
    .prepare(
      `SELECT seg, ter, qua, qui, sex, sab, dom,
              horario_abre, horario_fecha, local_nome, endereco, maps_link,
              entrega_status, whatsapp, mensagem_padrao
       FROM configuracoes_loja
       WHERE id = 1`,
    )
    .first<ConfigRow>();

  if (!row) throw new Error("configuracoes_loja sem registro principal");
  return rowToConfig(row);
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
  if (!body.openTime || !TIME_RE.test(body.openTime)) return "Horário de abertura inválido";
  if (!body.closeTime || !TIME_RE.test(body.closeTime)) return "Horário de fechamento inválido";
  if (!body.localName?.trim() || body.localName.trim().length > 120) return "Nome do local inválido";
  if (!body.address?.trim() || body.address.trim().length > 300) return "Endereço inválido";
  if ((body.mapsLink ?? "").length > 1000) return "Link do Google Maps muito longo";
  if (body.mapsLink) {
    try {
      const url = new URL(body.mapsLink);
      if (url.protocol !== "https:" && url.protocol !== "http:") return "Link do Google Maps inválido";
    } catch {
      return "Link do Google Maps inválido";
    }
  }
  if (!body.deliveryStatus || !DELIVERY.has(body.deliveryStatus)) return "Status de entrega inválido";
  if (!body.whatsapp || !isValidWhatsappBr(body.whatsapp)) return "WhatsApp inválido";
  if ((body.defaultMessage ?? "").length > 500) return "Mensagem padrão muito longa";
  return null;
}

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  try {
    return Response.json({ config: await readConfig(env.DB) });
  } catch (err) {
    console.error("Erro ao carregar configurações públicas da loja", err);
    return Response.json({ error: "Erro interno ao carregar configurações" }, { status: 500 });
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
    await env.DB
      .prepare(
        `UPDATE configuracoes_loja
         SET seg = ?, ter = ?, qua = ?, qui = ?, sex = ?, sab = ?, dom = ?,
             horario_abre = ?, horario_fecha = ?, local_nome = ?, endereco = ?,
             maps_link = ?, entrega_status = ?, whatsapp = ?, mensagem_padrao = ?,
             atualizado_em = CURRENT_TIMESTAMP
         WHERE id = 1`,
      )
      .bind(
        ...body.days!.map((day) => (day.active ? 1 : 0)),
        body.openTime,
        body.closeTime,
        body.localName!.trim(),
        body.address!.trim(),
        body.mapsLink?.trim() ?? "",
        body.deliveryStatus,
        body.whatsapp!.trim(),
        body.defaultMessage?.trim() ?? "",
      )
      .run();

    return Response.json({ config: await readConfig(env.DB) });
  } catch (err) {
    console.error("Erro ao salvar configurações da loja", err);
    return Response.json({ error: "Erro interno ao salvar configurações" }, { status: 500 });
  }
};
