import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { json, bodyJson, sameOrigin } from "../../lib/http.js";
import { requireUser } from "../../lib/auth.js";
import {
  consumePasskeyChallenge,
  parseTransports,
  passkeyContext,
  passkeyError,
  passkeyUserID,
  savePasskeyChallenge,
} from "../../lib/passkeys.js";

export async function onRequestGet({ request, env }) {
  const auth = await requireUser(env, request);
  if (auth.error) return auth.error;
  const { rpID } = passkeyContext(request);
  const { results } = await env.DB.prepare(`
    SELECT id, nome, device_type, backed_up, criado_em, ultimo_uso_em
    FROM admin_passkeys WHERE usuario_id=? AND rp_id=? ORDER BY id DESC
  `).bind(auth.user.id, rpID).all();
  return json({ passkeys: results || [] });
}

async function beginRegistration(request, env, user) {
  const { rpID, origin } = passkeyContext(request);
  const { results } = await env.DB.prepare(`
    SELECT credential_id, transports FROM admin_passkeys
    WHERE usuario_id=? AND rp_id=? ORDER BY id
  `).bind(user.id, rpID).all();
  const options = await generateRegistrationOptions({
    rpName: "R&P Doces Admin",
    rpID,
    userID: passkeyUserID(user.id),
    userName: user.username,
    userDisplayName: user.nome,
    timeout: 60000,
    attestationType: "none",
    supportedAlgorithmIDs: [-7, -257],
    authenticatorSelection: {
      residentKey: "required",
      userVerification: "required",
    },
    excludeCredentials: (results || []).map((row) => ({
      id: row.credential_id,
      transports: parseTransports(row.transports),
    })),
  });
  const challengeId = await savePasskeyChallenge(env, {
    userId: user.id,
    type: "REGISTRO",
    challenge: options.challenge,
    rpID,
    origin,
  });
  return json({ options, challenge_id: challengeId });
}

async function finishRegistration(request, env, user, data) {
  const response = data?.response;
  if (!response || typeof response !== "object") return json({ erro: "Resposta biométrica inválida." }, 400);
  const { rpID, origin } = passkeyContext(request);
  const challenge = await consumePasskeyChallenge(env, {
    id: data?.challenge_id,
    type: "REGISTRO",
    rpID,
    origin,
  });
  if (!challenge || Number(challenge.usuario_id) !== Number(user.id)) {
    return json({ erro: "Tentativa expirada. Tente novamente." }, 400);
  }

  try {
    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
      supportedAlgorithmIDs: [-7, -257],
    });
    if (!verification.verified || !verification.registrationInfo) throw new Error("Registro não verificado.");
    const info = verification.registrationInfo;
    const credential = info.credential;
    const nome = typeof data?.nome === "string" && data.nome.trim()
      ? data.nome.trim().slice(0, 80)
      : "Biometria deste aparelho";
    await env.DB.prepare(`
      INSERT INTO admin_passkeys
        (usuario_id, credential_id, public_key, counter, transports,
         device_type, backed_up, rp_id, nome)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      user.id,
      credential.id,
      credential.publicKey,
      credential.counter,
      JSON.stringify(credential.transports || response.response?.transports || []),
      info.credentialDeviceType,
      info.credentialBackedUp ? 1 : 0,
      rpID,
      nome,
    ).run();
    return json({ ok: true }, 201);
  } catch (error) {
    const duplicate = String(error?.message || error).includes("UNIQUE constraint failed");
    return json({ erro: duplicate ? "Esta biometria já está cadastrada." : passkeyError(error, "Não foi possível cadastrar a biometria.") }, duplicate ? 409 : 400);
  }
}

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return json({ erro: "Origem inválida." }, 403);
  const auth = await requireUser(env, request);
  if (auth.error) return auth.error;
  const data = await bodyJson(request, 65536);
  if (!data || typeof data !== "object" || Array.isArray(data)) return json({ erro: "Dados inválidos." }, 400);
  if (data.acao === "opcoes") return beginRegistration(request, env, auth.user);
  if (data.acao === "verificar") return finishRegistration(request, env, auth.user, data);
  return json({ erro: "Ação inválida." }, 400);
}

export async function onRequestDelete({ request, env }) {
  if (!sameOrigin(request)) return json({ erro: "Origem inválida." }, 403);
  const auth = await requireUser(env, request);
  if (auth.error) return auth.error;
  const data = await bodyJson(request);
  const id = Number(data?.id);
  if (!Number.isInteger(id) || id < 1) return json({ erro: "Credencial inválida." }, 400);
  const result = await env.DB.prepare("DELETE FROM admin_passkeys WHERE id=? AND usuario_id=?")
    .bind(id, auth.user.id).run();
  if (Number(result.meta?.changes || 0) !== 1) return json({ erro: "Credencial não encontrada." }, 404);
  return json({ ok: true });
}
