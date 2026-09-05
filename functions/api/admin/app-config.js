import { requireUser } from "../../lib/auth.js";
import {
  loadAppConfig,
  loadAppConfigHistory,
  restoreAppConfigRevision,
  saveAppConfig
} from "../../lib/app-config.js";
import { bodyJson, json, sameOrigin } from "../../lib/http.js";

async function requireAdmin(env, request) {
  const auth = await requireUser(env, request);
  if (auth.error) return auth;
  if (String(auth.user.papel || "").toUpperCase() !== "ADMIN") {
    return { error: json({ erro: "Apenas administradores podem alterar a configuração do app." }, 403) };
  }
  return auth;
}

export async function onRequestGet({ env, request }) {
  const auth = await requireAdmin(env, request);
  if (auth.error) return auth.error;

  const [config, history] = await Promise.all([
    loadAppConfig(env),
    loadAppConfigHistory(env, 20)
  ]);

  return json({ config, history });
}

export async function onRequestPut({ env, request }) {
  const auth = await requireAdmin(env, request);
  if (auth.error) return auth.error;
  if (!sameOrigin(request)) return json({ erro: "Origem da requisição inválida." }, 403);

  const payload = await bodyJson(request, 32768);
  if (!payload) return json({ erro: "Configuração inválida." }, 400);

  try {
    const config = await saveAppConfig(env, auth.user.id, payload);
    const history = await loadAppConfigHistory(env, 20);
    return json({ ok: true, config, history });
  } catch (error) {
    return json({ erro: error instanceof Error ? error.message : "Não foi possível salvar a configuração." }, 400);
  }
}

export async function onRequestPost({ env, request }) {
  const auth = await requireAdmin(env, request);
  if (auth.error) return auth.error;
  if (!sameOrigin(request)) return json({ erro: "Origem da requisição inválida." }, 403);

  const payload = await bodyJson(request, 4096);
  const revision = Number(payload?.restore_revision);
  if (!Number.isSafeInteger(revision) || revision < 1) {
    return json({ erro: "Revisão para restauração inválida." }, 400);
  }

  try {
    const config = await restoreAppConfigRevision(env, auth.user.id, revision);
    const history = await loadAppConfigHistory(env, 20);
    return json({ ok: true, config, history });
  } catch (error) {
    return json({ erro: error instanceof Error ? error.message : "Não foi possível restaurar a revisão." }, 400);
  }
}
