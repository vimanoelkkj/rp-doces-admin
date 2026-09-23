import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAdminTheme } from "../theme/AdminThemeContext";
import { useAdminPwa } from "../pwa/useAdminPwa";
import "./AdminLogin.css";

const IconMoon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
);

const IconSun = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="5" />
    <line x1="12" y1="1" x2="12" y2="3" />
    <line x1="12" y1="21" x2="12" y2="23" />
    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
    <line x1="1" y1="12" x2="3" y2="12" />
    <line x1="21" y1="12" x2="23" y2="12" />
    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
  </svg>
);

export default function AdminLogin() {
  useAdminPwa();
  const navigate = useNavigate();
  const { theme, toggleTheme } = useAdminTheme();
  const [step, setStep] = useState<"username" | "password">("username");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [displayHandle, setDisplayHandle] = useState("");
  const [initials, setInitials] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleContinue = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) return;

    // Derive display info from username
    const name = username.includes("@")
      ? username
          .split("@")[0]
          .replace(/[._]/g, " ")
          .replace(/\b\w/g, (c) => c.toUpperCase())
      : username.replace(/\b\w/g, (c) => c.toUpperCase());

    const handle = username.startsWith("@")
      ? username
      : `@${username.split("@")[0]}`;

    const parts = name.split(" ");
    const ini =
      parts.length >= 2
        ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
        : name.substring(0, 2).toUpperCase();

    setDisplayName(name);
    setDisplayHandle(handle);
    setInitials(ini);
    setStep("password");
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim() || loading) return;

    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, senha: password }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? "Falha ao entrar");
      }
      navigate("/admin");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao entrar");
    } finally {
      setLoading(false);
    }
  };

  const handleChangeUser = () => {
    setStep("username");
    setPassword("");
    setShowPassword(false);
    setError(null);
  };

  return (
    <div className="admin-login-page">
      {/* Background wave decoration */}
      <div className="admin-login-wave" aria-hidden="true">
        <svg
          viewBox="0 0 1440 500"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          preserveAspectRatio="none"
        >
          <path
            d="M0 0H1440V300C1440 300 1320 500 1080 450C840 400 720 500 480 420C240 340 120 440 0 380V0Z"
            fill="#EDDCC6"
          />
        </svg>
      </div>

      {/* Login Card */}
      <div className="admin-login-card">
        <button
          type="button"
          className="admin-login-theme-toggle"
          onClick={toggleTheme}
          aria-label={
            theme === "light" ? "Ativar tema escuro" : "Ativar tema claro"
          }
        >
          {theme === "light" ? <IconMoon /> : <IconSun />}
        </button>

        {/* Header: Logo + Badge */}
        <div className="admin-login-card-header">
          <div className="admin-login-logo-group">
            <div className="admin-login-logo-circle">
              <svg
                className="admin-login-cake"
                width="20"
                height="20"
                viewBox="0 0 20 20"
                fill="none"
              >
                <path
                  d="M16.6672 17.5V10.8336C16.6672 10.3916 16.4916 9.96772 16.179 9.65518C15.8664 9.34263 15.4425 9.16704 15.0004 9.16704H4.99962C4.55755 9.16704 4.1336 9.34263 3.82101 9.65518C3.50842 9.96772 3.33282 10.3916 3.33282 10.8336V17.5M3.33282 13.3335C3.33282 13.3335 3.74952 12.5002 4.99962 12.5002C6.24972 12.5002 7.08312 14.1668 8.33322 14.1668C9.58332 14.1668 10.4167 12.5002 11.6668 12.5002C12.9169 12.5002 13.7503 14.1668 15.0004 14.1668C16.2505 14.1668 16.6672 13.3335 16.6672 13.3335M1.66602 17.5H18.334M5.83302 6.66716V9.16704M10 6.66716V9.16704M14.167 6.66716V9.16704"
                  stroke="#634738"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
                <circle
                  className="flame flame-1"
                  cx="5.833"
                  cy="3.334"
                  r="1.2"
                  fill="#d38b80"
                />
                <circle
                  className="flame flame-2"
                  cx="10"
                  cy="3.334"
                  r="1.2"
                  fill="#d38b80"
                />
                <circle
                  className="flame flame-3"
                  cx="14.167"
                  cy="3.334"
                  r="1.2"
                  fill="#d38b80"
                />
              </svg>
            </div>
            <span className="admin-login-logo-text">R&amp;P Doces</span>
          </div>
          <div className="admin-login-badge">Painel Administrativo</div>
        </div>

        {/* Step: Username */}
        {step === "username" && (
          <form onSubmit={handleContinue} className="admin-login-form">
            <div className="admin-login-welcome">
              <h1>Bem-vindo de volta</h1>
              <p>Entre para gerenciar pedidos, produtos e a loja.</p>
            </div>

            <div className="admin-login-form-area">
              {/* Biometry button */}
              <button type="button" className="admin-login-biometry">
                <div className="admin-login-biometry-icon">
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#634738"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M7.864 4.243A7.5 7.5 0 0 1 19.5 10.5c0 2.92-.556 5.709-1.568 8.268M5.742 6.364A7.465 7.465 0 0 0 4.5 10.5a7.464 7.464 0 0 1-1.15 3.993m1.989 3.559A11.209 11.209 0 0 0 8.25 10.5a3.75 3.75 0 1 1 7.5 0c0 .527-.021 1.049-.064 1.565M12 10.5a14.94 14.94 0 0 1-3.6 9.75m6.633-4.596a18.666 18.666 0 0 1-2.485 5.33" />
                  </svg>
                </div>
                <div className="admin-login-biometry-text">
                  <strong>Entrar com biometria</strong>
                  <span>Rápido, seguro e sem precisar de senha</span>
                </div>
              </button>

              {/* Divider */}
              <div className="admin-login-divider">
                <span className="admin-login-divider-line" />
                <span className="admin-login-divider-text">
                  ou use seu usuário
                </span>
                <span className="admin-login-divider-line" />
              </div>

              {/* Username input */}
              <div className="admin-login-input-field">
                <label className="admin-login-label" htmlFor="admin-username">
                  Usuário
                </label>
                <div className="admin-login-input-box">
                  <input
                    id="admin-username"
                    type="text"
                    placeholder="Insira seu e-mail ou @usuario"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    autoFocus
                  />
                </div>
              </div>

              {/* Submit */}
              <button type="submit" className="admin-login-submit">
                Continuar
              </button>
            </div>

            <p className="admin-login-footer-text">
              A autenticação biométrica precisa estar habilitada no seu
              dispositivo e integrada ao painel da R&amp;P Doces.
            </p>
          </form>
        )}

        {/* Step: Password */}
        {step === "password" && (
          <form onSubmit={handleLogin} className="admin-login-form">
            {/* User identity card */}
            <div className="admin-login-user-identity">
              <div className="admin-login-avatar">{initials}</div>
              <div className="admin-login-user-text">
                <strong>{displayName}</strong>
                <span>{displayHandle}</span>
              </div>
              <button
                type="button"
                className="admin-login-change-user"
                onClick={handleChangeUser}
              >
                Alterar
              </button>
            </div>

            <div className="admin-login-form-area">
              {/* Password input */}
              <div className="admin-login-input-field">
                <label className="admin-login-label" htmlFor="admin-password">
                  Senha
                </label>
                <div className="admin-login-input-box">
                  <input
                    id="admin-password"
                    type={showPassword ? "text" : "password"}
                    placeholder="••••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoFocus
                  />
                  <button
                    type="button"
                    className="admin-login-eye-toggle"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={
                      showPassword ? "Esconder senha" : "Mostrar senha"
                    }
                  >
                    {showPassword ? (
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="#8c7a76"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    ) : (
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="#8c7a76"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                        <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                        <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
                        <line x1="1" y1="1" x2="23" y2="23" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              {error && <p className="admin-login-error">{error}</p>}

              {/* Submit */}
              <button
                type="submit"
                className="admin-login-submit"
                disabled={loading}
              >
                {loading ? "Entrando…" : "Entrar"}
              </button>

              {/* Forgot password */}
              <div className="admin-login-forgot-wrapper">
                <button type="button" className="admin-login-forgot">
                  Esqueci minha senha
                </button>
              </div>
            </div>

            <p className="admin-login-footer-text">
              Sua conta está protegida por criptografia de ponta a ponta. Nunca
              compartilhe suas credenciais.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
