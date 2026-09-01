import { FormEvent, ReactNode, useEffect, useState } from "react";
import { AuthError, AuthUser, getCurrentUser, login, logout } from "./auth.api";
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

function messageFromError(error: unknown, fallback: string): string {
  if (error instanceof AuthError) return error.message;
  if (error instanceof Error) return error.message;
  return fallback;
}

export function AuthGate({ children }: Props) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    getCurrentUser()
      .then(current => {
        if (active) setUser(current);
      })
      .catch(err => {
        if (active) setError(messageFromError(err, "Falha ao verificar a sessão."));
      })
      .finally(() => {
        if (active) setChecking(false);
      });

    return () => {
      active = false;
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const username = String(data.get("username") || "").trim();
    const senha = String(data.get("senha") || "");

    if (!username || !senha) {
      setError("Informe usuário e senha.");
      return;
    }

    setSubmitting(true);
    setError(null);
    setLogoutError(null);

    try {
      const authenticated = await login(username, senha);
      const completeUser = await getCurrentUser();
      setUser(completeUser ?? authenticated);
      form.reset();
    } catch (err) {
      setError(messageFromError(err, "Não foi possível entrar."));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleLogout() {
    if (loggingOut) return;

    setLoggingOut(true);
    setLogoutError(null);

    try {
      await logout();
      setUser(null);
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
      <section className={styles.card} aria-labelledby="login-title">
        <div>
          <span className={styles.eyebrow}>R&amp;P Doces · Admin V2</span>
          <h1 id="login-title">Entrar</h1>
          <p>Use a mesma conta do painel administrativo atual.</p>
        </div>

        <form className={styles.form} onSubmit={handleSubmit} autoComplete="on">
          <label>
            <span>Usuário</span>
            <input name="username" type="text" autoComplete="username" maxLength={80} required />
          </label>

          <label>
            <span>Senha</span>
            <input name="senha" type="password" autoComplete="current-password" maxLength={256} required />
          </label>

          {error ? (
            <div className={styles.error} role="alert">
              {error}
            </div>
          ) : null}

          <button type="submit" disabled={submitting}>
            {submitting ? "Entrando…" : "Entrar"}
          </button>
        </form>
      </section>
    </main>
  );
}
