/// <reference types="@cloudflare/workers-types" />

const COOKIE_NAME = "rp_admin_session";
const SESSION_DAYS = 7;
const PBKDF2_ITERATIONS = 100000;

export interface AdminUser {
  id: number;
  nome: string;
  username: string;
  email: string;
  ativo: number;
  papel: "OWNER" | "ADMIN";
}

function bytesToHex(bytes: ArrayBuffer | Uint8Array): string {
  return [...new Uint8Array(bytes)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function randomToken(bytes = 32): string {
  const arr = crypto.getRandomValues(new Uint8Array(bytes));
  let s = "";
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return bytesToHex(digest);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITERATIONS },
    key,
    256,
  );
  return `pbkdf2_sha256$${PBKDF2_ITERATIONS}$${bytesToHex(salt)}$${bytesToHex(bits)}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  try {
    const [algo, iterationsText, saltHex, hashHex] = stored.split("$");
    if (algo !== "pbkdf2_sha256") return false;

    const iterations = Number(iterationsText);
    if (
      !Number.isSafeInteger(iterations) ||
      iterations < 1 ||
      iterations > PBKDF2_ITERATIONS
    ) {
      return false;
    }

    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveBits"],
    );
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt: hexToBytes(saltHex), iterations },
      key,
      256,
    );
    const computed = new Uint8Array(bits);
    const expected = hexToBytes(hashHex);
    if (computed.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < computed.length; i++) diff |= computed[i] ^ expected[i];
    return diff === 0;
  } catch {
    return false;
  }
}

export function validatePassword(password: string): string | null {
  if (typeof password !== "string" || password.length < 8) {
    return "A senha precisa ter pelo menos 8 caracteres";
  }
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return "Use pelo menos uma letra e um número";
  }
  return null;
}

export function getCookie(request: Request, name = COOKIE_NAME): string | null {
  const raw = request.headers.get("Cookie") || "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

export async function createSession(
  db: D1Database,
  userId: number,
): Promise<{ token: string; cookie: string }> {
  const token = randomToken(32);
  const tokenHash = await sha256(token);
  const expiresAt = new Date(
    Date.now() + SESSION_DAYS * 86400000,
  ).toISOString();

  await db
    .prepare(
      `INSERT INTO admin_sessoes (usuario_id, token_hash, expira_em) VALUES (?, ?, ?)`,
    )
    .bind(userId, tokenHash, expiresAt)
    .run();

  const cookie = `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}`;
  return { token, cookie };
}

export async function destroySession(
  db: D1Database,
  request: Request,
): Promise<string> {
  const token = getCookie(request);
  if (token) {
    await db
      .prepare(`DELETE FROM admin_sessoes WHERE token_hash = ?`)
      .bind(await sha256(token))
      .run();
  }
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

export async function currentUser(
  db: D1Database,
  request: Request,
): Promise<AdminUser | null> {
  const token = getCookie(request);
  if (!token) return null;
  const hash = await sha256(token);
  const now = new Date().toISOString();
  const user = await db
    .prepare(
      `SELECT u.id, u.nome, u.username, u.email, u.ativo, u.papel
       FROM admin_sessoes s
       JOIN usuarios_admin u ON u.id = s.usuario_id
       WHERE s.token_hash = ? AND s.expira_em > ? AND u.ativo = 1
       LIMIT 1`,
    )
    .bind(hash, now)
    .first<AdminUser>();
  return user ?? null;
}

export async function requireUser(
  db: D1Database,
  request: Request,
): Promise<{ user: AdminUser } | { error: Response }> {
  const user = await currentUser(db, request);
  if (!user) {
    return { error: Response.json({ error: "Não autenticado" }, { status: 401 }) };
  }
  return { user };
}

export function sameOrigin(request: Request): boolean {
  const expected = new URL(request.url).origin;
  const origin = request.headers.get("Origin");
  if (origin) return origin === expected;

  const referer = request.headers.get("Referer");
  if (referer) {
    try {
      return new URL(referer).origin === expected;
    } catch {
      return false;
    }
  }

  return ["GET", "HEAD", "OPTIONS"].includes(request.method);
}
