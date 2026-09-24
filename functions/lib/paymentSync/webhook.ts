/// <reference types="@cloudflare/workers-types" />

import type { ResolveWebhookPaymentResult } from "./types";
import { type MpPaymentResponse, isVerifiedMpResponse } from "./client";

// Resolução do pagamento a ser sincronizado, para o webhook.
//
// 1) Caminho direto: mp_payment_id já persistido (caso feliz, checkout já
//    completou o roundtrip com o MP antes do webhook chegar).
// 2) Fallback por external_reference = idempotency_key da tentativa (Pix
//    administrativo, origem ADMIN — ver comandaPix.ts): idempotency_key já
//    é único por natureza (índice único, migration 0008), então esse
//    fallback nunca é ambíguo por construção, mesmo com múltiplos Pix
//    administrativos pendentes no mesmo pedido.
// 3) Fallback por external_reference = token_publico (checkout do site,
//    inalterado): cobre a corrida checkout-ainda-não-persistiu-
//    mp_payment_id. Nunca escolhe "o mais recente" entre candidatos — 0
//    candidatos é "não encontrado", >1 é "ambíguo, não decide", só
//    exatamente 1 é resolvido.
// Quando qualquer fallback resolve, persiste mp_payment_id nessa linha
// (protegido por CAS) para que o próximo evento já resolva pelo caminho
// direto.
export async function resolveWebhookPayment(
  db: D1Database,
  payment: MpPaymentResponse,
): Promise<ResolveWebhookPaymentResult> {
  if (!isVerifiedMpResponse(payment)) throw new Error("RESPOSTA_MP_NAO_VERIFICADA");
  const mpPaymentId = String(payment.id);

  const { results: diretos } = await db
    .prepare(`SELECT id FROM pedido_pagamentos WHERE metodo = 'PIX_MP' AND mp_payment_id = ? LIMIT 2`)
    .bind(mpPaymentId)
    .all<{ id: number }>();
  if (diretos.length > 1) return { kind: "ambiguous" };
  if (diretos.length === 1) return { kind: "found", pagamentoId: Number(diretos[0].id) };

  const externalReference = String(payment.external_reference || "").trim();
  if (!externalReference) return { kind: "not_found" };

  const porIdempotencyKey = await db
    .prepare(
      `SELECT id FROM pedido_pagamentos
       WHERE metodo = 'PIX_MP' AND origem = 'ADMIN' AND status IN ('PENDENTE', 'EXPIRADO') AND idempotency_key = ?
       LIMIT 1`,
    )
    .bind(externalReference)
    .first<{ id: number }>();
  if (porIdempotencyKey) {
    return associateWebhookPayment(db, Number(porIdempotencyKey.id), mpPaymentId);
  }

  const tokenPublico = externalReference;

  const pedido = await db
    .prepare(`SELECT id FROM pedidos WHERE token_publico = ? LIMIT 1`)
    .bind(tokenPublico)
    .first<{ id: number }>();
  if (!pedido) return { kind: "not_found" };

  const { results: candidatos } = await db
    .prepare(
      `SELECT id FROM pedido_pagamentos
       WHERE pedido_id = ? AND metodo = 'PIX_MP' AND origem = 'SITE' AND status IN ('PENDENTE', 'EXPIRADO')
       LIMIT 2`,
    )
    .bind(pedido.id)
    .all<{ id: number }>();

  if (!candidatos || candidatos.length === 0) return { kind: "not_found" };
  if (candidatos.length > 1) return { kind: "ambiguous" };

  return associateWebhookPayment(db, Number(candidatos[0].id), mpPaymentId);
}

async function associateWebhookPayment(db: D1Database, pagamentoId: number, mpPaymentId: string): Promise<ResolveWebhookPaymentResult> {
  await db
    .prepare(
      `UPDATE pedido_pagamentos SET mp_payment_id = ?, atualizado_em = CURRENT_TIMESTAMP
       WHERE id = ? AND status IN ('PENDENTE', 'EXPIRADO') AND mp_payment_id IS NULL
         AND (origem = 'ADMIN' OR (
           SELECT COUNT(*) FROM pedido_pagamentos candidato
           WHERE candidato.pedido_id = pedido_pagamentos.pedido_id AND candidato.metodo = 'PIX_MP'
             AND candidato.origem = 'SITE' AND candidato.status IN ('PENDENTE', 'EXPIRADO')
         ) = 1)
         AND NOT EXISTS (SELECT 1 FROM pedido_pagamentos WHERE mp_payment_id = ? AND metodo = 'PIX_MP')`,
    )
    .bind(mpPaymentId, pagamentoId, mpPaymentId)
    .run();
  // Outro evento pode ter associado outro ID ou concluído a mesma associação.
  // Nunca retorna o candidato sem verificar quem de fato ficou com o ID.
  const { results } = await db.prepare(
    `SELECT id FROM pedido_pagamentos WHERE metodo = 'PIX_MP' AND mp_payment_id = ? LIMIT 2`,
  ).bind(mpPaymentId).all<{ id: number }>();
  return results.length === 1 && results[0].id === pagamentoId
    ? { kind: "found", pagamentoId }
    : { kind: "ambiguous" };
}

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Porta fiel do protocolo HMAC de produção: manifest
// `id:<data.id>;request-id:<x-request-id>;ts:<ts>;` assinado com
// HMAC-SHA256 e comparado contra x-signature de forma timing-safe.
export async function validateMpWebhookSignature(
  request: Request,
  secret: string,
  dataId: string,
): Promise<boolean> {
  if (!secret) return false;
  const signature = request.headers.get("x-signature") || "";
  const requestId = request.headers.get("x-request-id") || "";
  const parts = Object.fromEntries(signature.split(",").map((p) => p.trim().split("=")));
  const ts = parts.ts;
  const v1 = parts.v1;
  if (!ts || !v1) return false;

  let manifest = "";
  if (dataId) manifest += `id:${String(dataId).toLowerCase()};`;
  if (requestId) manifest += `request-id:${requestId};`;
  manifest += `ts:${ts};`;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(manifest));
  return timingSafeEqual(hex(digest), v1.toLowerCase());
}
