import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse
} from "@simplewebauthn/server";
import { json, bodyJson, sameOrigin } from "../../lib/http.js";
import { createSession } from "../../lib/auth.js";
import {
  checkLoginRateLimit,
  recordLoginFailure,
  clearLoginFailures
} from "../../lib/rateLimit.js";
import {
  consumePasskeyChallenge,
  parseTransports,
  passkeyContext,
  passkeyError,
  publicKeyBytes,
  savePasskeyChallenge
} from "../../lib/passkeys.js";

async function beginLogin(request, env, data) {
  const username = String(data?.username || "")
    .trim()
    .toLowerCase();
  if (username.length > 80) return json({ erro: "Usuário inválido." }, 400);

  const rate = await checkLoginRateLimit(env, request, username || "passkey");
  if (!rate.allowed) {
    return json({ erro: "Muitas tentativas. Tente novamente em alguns minutos." }, 429, {
      "retry-after": String(rate.retryAfter)
    });
  }

  const { rpID, origin } = passkeyContext(request);
  if (!username) {
    const available = await env.DB.prepare(
      `
      SELECT 1 FROM admin_passkeys p
      JOIN usuarios_admin u ON u.id=p.usuario_id
      WHERE p.rp_id=? AND u.ativo=1 LIMIT 1
    `
    )
      .bind(rpID)
      .first();
    if (!available) return json({ erro: "Nenhuma biometria cadastrada neste endereço." }, 404);
    const options = await generateAuthenticationOptions({
      rpID,
      timeout: 60000,
      userVerification: "required"
    });
    const challengeId = await savePasskeyChallenge(env, {
      userId: null,
      type: "LOGIN",
      challenge: options.challenge,
      rpID,
      origin
    });
    return json({ options, challenge_id: challengeId });
  }

  const user = await env.DB.prepare(
    `
    SELECT id, username, ativo FROM usuarios_admin WHERE username=? LIMIT 1
  `
  )
    .bind(username)
    .first();
  if (!user || !user.ativo) {
    await recordLoginFailure(env, rate.key);
    return json({ erro: "Biometria não cadastrada para este usuário." }, 401);
  }

  const { results } = await env.DB.prepare(
    `
    SELECT credential_id, transports FROM admin_passkeys
    WHERE usuario_id=? AND rp_id=? ORDER BY id
  `
  )
    .bind(user.id, rpID)
    .all();
  if (!results?.length) return json({ erro: "Biometria não cadastrada para este usuário." }, 404);

  const options = await generateAuthenticationOptions({
    rpID,
    timeout: 60000,
    userVerification: "required",
    allowCredentials: results.map(row => ({
      id: row.credential_id,
      transports: parseTransports(row.transports)
    }))
  });
  const challengeId = await savePasskeyChallenge(env, {
    userId: user.id,
    type: "LOGIN",
    challenge: options.challenge,
    rpID,
    origin
  });
  return json({ options, challenge_id: challengeId });
}

async function finishLogin(request, env, data) {
  const response = data?.response;
  if (!response || typeof response !== "object" || typeof response.id !== "string") {
    return json({ erro: "Resposta biométrica inválida." }, 400);
  }

  const { rpID, origin } = passkeyContext(request);
  const challenge = await consumePasskeyChallenge(env, {
    id: data?.challenge_id,
    type: "LOGIN",
    rpID,
    origin
  });
  if (!challenge) return json({ erro: "Tentativa expirada. Tente novamente." }, 400);

  const credential = await env.DB.prepare(
    `
    SELECT p.id, p.usuario_id, p.credential_id, p.public_key, p.counter, p.transports,
           u.nome, u.username, u.email, u.ativo
    FROM admin_passkeys p
    JOIN usuarios_admin u ON u.id=p.usuario_id
    WHERE p.credential_id=? AND p.rp_id=?
      AND (? IS NULL OR p.usuario_id=?)
    LIMIT 1
  `
  )
    .bind(response.id, rpID, challenge.usuario_id, challenge.usuario_id)
    .first();
  if (!credential || !credential.ativo) return json({ erro: "Biometria não reconhecida." }, 401);

  const rate = await checkLoginRateLimit(env, request, credential.username);
  if (!rate.allowed) {
    return json({ erro: "Muitas tentativas. Tente novamente em alguns minutos." }, 429, {
      "retry-after": String(rate.retryAfter)
    });
  }

  try {
    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
      credential: {
        id: credential.credential_id,
        publicKey: publicKeyBytes(credential.public_key),
        counter: Number(credential.counter || 0),
        transports: parseTransports(credential.transports)
      }
    });
    if (!verification.verified) throw new Error("Assertion não verificada.");

    await env.DB.prepare(
      `
      UPDATE admin_passkeys SET counter=?, ultimo_uso_em=CURRENT_TIMESTAMP
      WHERE id=?
    `
    )
      .bind(verification.authenticationInfo.newCounter, credential.id)
      .run();
    await clearLoginFailures(env, rate.key);
    await env.DB.prepare("DELETE FROM admin_sessoes WHERE expira_em <= ?")
      .bind(new Date().toISOString())
      .run();
    const session = await createSession(env, credential.usuario_id);
    return json({ ok: true }, 200, { "set-cookie": session.cookie });
  } catch (error) {
    await recordLoginFailure(env, rate.key);
    return json({ erro: passkeyError(error) }, 401);
  }
}

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return json({ erro: "Origem inválida." }, 403);
  const data = await bodyJson(request, 65536);
  if (!data || typeof data !== "object" || Array.isArray(data))
    return json({ erro: "Dados inválidos." }, 400);
  if (data.acao === "opcoes") return beginLogin(request, env, data);
  if (data.acao === "verificar") return finishLogin(request, env, data);
  return json({ erro: "Ação inválida." }, 400);
}
