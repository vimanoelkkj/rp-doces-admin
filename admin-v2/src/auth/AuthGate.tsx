import { FormEvent, ReactNode, useEffect, useRef, useState } from "react";
import {
  AuthError,
  AuthUser,
  IdentifiedUser,
  PasskeyBegin,
  beginPasskeyLogin,
  finishPasskeyLogin,
  getCurrentUser,
  identify,
  login,
  logout
} from "./auth.api";
import styles from "./AuthGate.module.css";

export type AuthSession = {
  user: AuthUser;
  logout: () => Promise<void>;
  loggingOut: boolean;
  logoutError: string | null;
};

type Props = {
  children: (session: AuthSession) => ReactNode;
};

type LoginStage = "username" | "password";

function messageFromError(error: unknown, fallback: string): string {
  if (error instanceof AuthError) return error.message;
  if (error instanceof Error) return error.message;
  return fallback;
}

function initials(name = ""): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (
    parts
      .slice(0, 2)
      .map(part => part[0] ?? "")
      .join("") || "RP"
  ).toUpperCase();
}

function fromUrlB64(value: string): Uint8Array {
  const padded = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

function toUrlB64(value: ArrayBuffer): string {
  const bytes = new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function requestOptionsFromJSON(options: PasskeyBegin["options"]): PublicKeyCredentialRequestOptions {
  const raw = options as Record<string, unknown>;
  const allowCredentials = Array.isArray(options.allowCredentials)
    ? options.allowCredentials.map(item => ({
        ...item,
        id: fromUrlB64(item.id)
      }))
    : undefined;

  return {
    ...raw,
    challenge: fromUrlB64(options.challenge),
    allowCredentials
  } as PublicKeyCredentialRequestOptions;
}

function authenticationToJSON(credential: PublicKeyCredential): unknown {
  const response = credential.response as AuthenticatorAssertionResponse;
  return {
    id: credential.id,
    rawId: toUrlB64(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment || undefined,
    clientExtensionResults: credential.getClientExtensionResults(),
    response: {
      clientDataJSON: toUrlB64(response.clientDataJSON),
      authenticatorData: toUrlB64(response.authenticatorData),
      signature: toUrlB64(response.signature),
      userHandle: response.userHandle ? toUrlB64(response.userHandle) : null
    }
  };
}

export function AuthGate({ children }: Props) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [checking, setChecking] = useState(true);
  const [stage, setStage] = useState<LoginStage>("username");
  const [identifiedUser, setIdentifiedUser] = useState<IdentifiedUser | null>(null);
  const [username, setUsername] = useState("");
  const [status, setStatus] = useState("");
  const [statusError, setStatusError] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const usernameInputRef = useRef<HTMLInputElement>(null);
  const passwordInputRef = useRef<HTMLInputElement>(null);

  const passkeySupported =
    typeof window !== "undefined" &&
    "PublicKeyCredential" in window &&
    typeof navigator !== "undefined" &&
    Boolean(navigator.credentials);

  useEffect(() => {
    let active = true;

    getCurrentUser()
      .then(current => {
        if (active) setUser(current);
      })
      .catch(err => {
        if (active) {
          setStatus(messageFromError(err, "Falha ao verificar a sessão."));
          setStatusError(true);
        }
      })
      .finally(() => {
        if (active) setChecking(false);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (checking || user) return;
    const target = stage === "username" ? usernameInputRef.current : passwordInputRef.current;
    if (!target) return;
    requestAnimationFrame(() => {
      target.focus();
      if (stage === "username") target.select();
    });
  }, [checking, stage, user]);

  function clearStatus() {
    setStatus("");
    setStatusError(false);
  }

  async function handleIdentify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = username.trim().toLowerCase();
    if (!normalized || submitting) return;

    setSubmitting(true);
    setStatus("Procurando sua conta…");
    setStatusError(false);

    try {
      const found = await identify(normalized);
      if (!found) {
        setStatus("Não encontramos uma conta ativa com esse usuário.");
        setStatusError(true);
        return;
      }

      setUsername(found.username);
      setIdentifiedUser(found);
      clearStatus();
      setStage("password");
    } catch (err) {
      setStatus(messageFromError(err, "Não foi possível localizar a conta."));
      setStatusError(true);
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || !identifiedUser) return;

    const form = event.currentTarget;
    const data = new FormData(form);
    const senha = String(data.get("senha") || "");
    if (!senha) return;

    setSubmitting(true);
    setStatus("Entrando…");
    setStatusError(false);
    setLogoutError(null);

    try {
      await login(identifiedUser.username, senha);
      const completeUser = await getCurrentUser();
      if (!completeUser) {
        throw new AuthError("A sessão não foi estabelecida após o login.", 401);
      }
      setUser(completeUser);
      form.reset();
    } catch (err) {
      setStatus(messageFromError(err, "Não foi possível entrar."));
      setStatusError(true);
      requestAnimationFrame(() => passwordInputRef.current?.select());
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePasskey() {
    if (!passkeySupported || passkeyBusy) return;

    setPasskeyBusy(true);
    setStatus("Aguardando a verificação do aparelho…");
    setStatusError(false);

    try {
      const begin = await beginPasskeyLogin();
      const credential = await navigator.credentials.get({
        publicKey: requestOptionsFromJSON(begin.options)
      });
      if (!(credential instanceof PublicKeyCredential)) {
        throw new Error("A autenticação não foi concluída.");
      }

      await finishPasskeyLogin(begin.challenge_id, authenticationToJSON(credential));
      setStatus("Identidade confirmada. Entrando…");
      const completeUser = await getCurrentUser();
      if (!completeUser) {
        throw new AuthError("A sessão não foi estabelecida após o login.", 401);
      }
      setUser(completeUser);
    } catch (err) {
      const cancelled =
        err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "AbortError");
      setStatus(cancelled ? "Autenticação cancelada." : messageFromError(err, "Não foi possível usar a biometria."));
      setStatusError(true);
    } finally {
      setPasskeyBusy(false);
    }
  }

  function switchUser() {
    setStage("username");
    setIdentifiedUser(null);
    clearStatus();
  }

  async function handleLogout() {
    if (loggingOut) return;

    setLoggingOut(true);
    setLogoutError(null);

    try {
      await logout();
      setUser(null);
      setStage("username");
      setIdentifiedUser(null);
      clearStatus();
    } catch (err) {
      setLogoutError(messageFromError(err, "Não foi possível sair."));
    } finally {
      setLoggingOut(false);
    }
  }

  if (checking) {
    return (
      <main className={styles.centered} aria-busy="true">
        <div className={styles.statusCard}>Verificando sessão…</div>
      </main>
    );
  }

  if (user) {
    return <>{children({ user, logout: handleLogout, loggingOut, logoutError })}</>;
  }

  return (
    <main className={styles.centered}>
      <section
        className={`${styles.card} ${stage === "password" ? styles.passwordStageCard : ""}`}
        aria-labelledby="login-title"
      >
        <div className={styles.brand} aria-hidden="true">R&amp;P</div>

        <div className={styles.heading}>
          <span>Painel administrativo</span>
          <h1 id="login-title">Bem-vindo de volta</h1>
          <p>Entre para gerenciar pedidos, produtos e a loja.</p>
        </div>

        {passkeySupported ? (
          <button
            className={styles.passkey}
            type="button"
            onClick={() => void handlePasskey()}
            disabled={passkeyBusy}
          >
            <span className={styles.passkeyIcon} aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M12 3a5 5 0 0 0-5 5v2M17 10V8a5 5 0 0 0-5-5M5 13v2a7 7 0 0 0 14 0v-2M9 12v3a3 3 0 0 0 6 0v-3M12 8v4" />
              </svg>
            </span>
            <span>
              <strong>Entrar com biometria</strong>
              <small>Digital, rosto ou passkey do aparelho</small>
            </span>
          </button>
        ) : null}

        <div className={styles.separator}><span>ou use sua senha</span></div>

        {stage === "username" ? (
          <div className={styles.stage}>
            <form className={styles.form} onSubmit={handleIdentify} autoComplete="on">
              <label>
                <span>Usuário</span>
                <input
                  ref={usernameInputRef}
                  name="username"
                  type="text"
                  autoComplete="username"
                  maxLength={80}
                  autoCapitalize="none"
                  spellCheck={false}
                  value={username}
                  onChange={event => setUsername(event.target.value)}
                  required
                />
              </label>
              <button className={styles.submit} type="submit" disabled={submitting}>
                {submitting ? "Procurando…" : "Continuar"}
              </button>
            </form>
          </div>
        ) : identifiedUser ? (
          <div className={styles.stage}>
            <div className={styles.identity}>
              <div className={styles.avatar} aria-hidden="true">
                {identifiedUser.avatar_url ? (
                  <img src={identifiedUser.avatar_url} alt="" />
                ) : (
                  initials(identifiedUser.nome || identifiedUser.username)
                )}
              </div>
              <strong>{identifiedUser.nome || identifiedUser.username}</strong>
              <span>@{identifiedUser.username}</span>
            </div>

            <form className={styles.form} onSubmit={handlePassword} autoComplete="on">
              <label>
                <span>Senha</span>
                <input
                  ref={passwordInputRef}
                  name="senha"
                  type="password"
                  autoComplete="current-password"
                  maxLength={256}
                  required
                />
              </label>
              <button className={styles.submit} type="submit" disabled={submitting}>
                {submitting ? "Entrando…" : "Entrar"}
              </button>
            </form>

            <button className={styles.switchUser} type="button" onClick={switchUser}>
              Trocar usuário
            </button>
          </div>
        ) : null}

        <p className={`${styles.status} ${statusError ? styles.statusError : ""}`} role="status" aria-live="polite">
          {status}
        </p>
        <p className={styles.foot}>
          A biometria permanece no seu dispositivo e não é enviada à R&amp;P Doces.
        </p>
      </section>
    </main>
  );
}
