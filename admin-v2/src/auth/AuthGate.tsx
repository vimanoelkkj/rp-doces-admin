import { FormEvent, ReactNode, useEffect, useState } from "react";
import { AuthError, AuthUser, getCurrentUser, login } from "./auth.api";
import styles from "./AuthGate.module.css";

type Props = {
  children: (user: AuthUser) => ReactNode;
};

export function AuthGate({ children }: Props) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;

    getCurrentUser()
      .then(current => {
        if (active) setUser(current);
      })
      .catch(err => {
        if (active) setError(err instanceof Error ? err.message : "Falha ao verificar a sessão.");
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

    try {
      const authenticated = await login(username, senha);
      const completeUser = await getCurrentUser();
      setUser(completeUser ?? authenticated);
      form.reset();
    } catch (err) {
      if (err instanceof AuthError) setError(err.message);
      else setError(err instanceof Error ? err.message : "Não foi possível entrar.");
    } finally {
      setSubmitting(false);
    }
  }

  if (checking) {
    return (
      <main className={styles.centered} aria-busy="true">
        <div className={styles.statusCard}>Verificando sessão…</div>
      </main>
    );
  }

  if (user) return <>{children(user)}</>;

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
