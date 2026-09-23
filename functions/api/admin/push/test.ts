/// <reference types="@cloudflare/workers-types" />

import { requireUser, sameOrigin } from "../../../lib/auth";
import { sendPushNotification } from "@mmmike/web-push/send";

interface Env {
  DB: D1Database;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
}

interface TestPushInput {
  endpoint?: unknown;
}

const MAX_ENDPOINT_LENGTH = 1024;

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  // 1. Validação de origem (CSRF)
  if (!sameOrigin(request)) {
    return jsonError("Origem inválida", 403);
  }

  // 2. Autenticação obrigatória de admin
  const auth = await requireUser(env.DB, request);
  if ("error" in auth) return auth.error;

  // 3. Parsing estrito do JSON
  let body: TestPushInput;
  try {
    body = await request.json();
  } catch {
    return jsonError("JSON inválido no corpo da requisição", 400);
  }

  // 4. Validação de endpoint
  const endpoint = typeof body.endpoint === "string" ? body.endpoint.trim() : "";
  if (!endpoint || !endpoint.startsWith("https://") || endpoint.length > MAX_ENDPOINT_LENGTH) {
    return jsonError("Endpoint inválido ou ausente (deve iniciar com https://)", 400);
  }

  // 5. Busca subscription pertencente OBRIGATORIAMENTE a este usuário autenticado
  const sub = await env.DB.prepare(
    "SELECT id, endpoint, p256dh, auth FROM push_inscricoes WHERE endpoint = ? AND usuario_id = ?",
  )
    .bind(endpoint, auth.user.id)
    .first<{
      id: number;
      endpoint: string;
      p256dh: string;
      auth: string;
    }>();

  if (!sub) {
    return jsonError("Inscrição de notificação não encontrada para este dispositivo", 404);
  }

  // 6. Configuração VAPID
  const publicKey = env.VAPID_PUBLIC_KEY;
  const privateKey = env.VAPID_PRIVATE_KEY;
  const subject = env.VAPID_SUBJECT || "mailto:contato@rpdoces.com.br";

  if (!publicKey || !privateKey) {
    return jsonError("Chaves VAPID não configuradas no servidor", 500);
  }

  // 7. Payload de teste sem PII e sem pedidoId
  const payload = {
    title: "Teste de notificação 🍰",
    body: "Se você recebeu isto, as notificações estão funcionando.",
    tag: "rp-push-test",
    url: "/admin/notificacoes",
  };

  // 8. Despacho direto isolado (sem criar push_eventos, sem mexer em pedidos)
  try {
    const delivered = await sendPushNotification(
      {
        endpoint: sub.endpoint,
        keys: {
          p256dh: sub.p256dh,
          auth: sub.auth,
        },
      },
      payload,
      {
        publicKey,
        privateKey,
        subject,
      },
    );

    if (!delivered) {
      // 404/410 do push service: inscrição expirada. Remove apenas esta inscrição do usuário.
      await env.DB.prepare(
        "DELETE FROM push_inscricoes WHERE id = ? AND usuario_id = ?",
      )
        .bind(sub.id, auth.user.id)
        .run();

      return Response.json(
        {
          ok: false,
          stale: true,
          error: "Inscrição expirada no serviço de push. Ative as notificações novamente.",
        },
        { status: 410 },
      );
    }

    return Response.json({
      ok: true,
      message: "Notificação de teste enviada com sucesso.",
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Erro ao enviar Web Push de teste para subscription", sub.id, err);
    return jsonError(`Falha ao despachar notificação de teste: ${message}`, 502);
  }
};
