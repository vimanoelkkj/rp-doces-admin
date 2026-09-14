import { useState } from "react";
import "./AdminLogin.css";

export default function AdminLogin() {
  const [step, setStep] = useState<"username" | "password">("username");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [displayHandle, setDisplayHandle] = useState("");
  const [initials, setInitials] = useState("");

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

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) return;
    // TODO: integrar autenticação real
    console.log("Login:", { username, password });
  };

  const handleChangeUser = () => {
    setStep("username");
    setPassword("");
    setShowPassword(false);
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
        {/* Header: Logo + Badge */}
        <div className="admin-login-card-header">
          <div className="admin-login-logo-group">
            <div className="admin-login-logo-circle">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path
                  d="M16.6672 17.5V10.8336C16.6672 10.3916 16.4916 9.96772 16.179 9.65518C15.8664 9.34263 15.4425 9.16704 15.0004 9.16704H4.99962C4.55755 9.16704 4.1336 9.34263 3.82101 9.65518C3.50842 9.96772 3.33282 10.3916 3.33282 10.8336V17.5M3.33282 13.3335C3.33282 13.3335 3.74952 12.5002 4.99962 12.5002C6.24972 12.5002 7.08312 14.1668 8.33322 14.1668C9.58332 14.1668 10.4167 12.5002 11.6668 12.5002C12.9169 12.5002 13.7503 14.1668 15.0004 14.1668C16.2505 14.1668 16.6672 13.3335 16.6672 13.3335M1.66602 17.5H18.334M5.83302 6.66716V9.16704M10 6.66716V9.16704M14.167 6.66716V9.16704"
                  stroke="#634738"
                  strokeWidth="2"
                  strokeLinecap="round"
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
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M2 12C2 6.5 6.5 2 12 2a10 10 0 0 1 8 4" />
                    <path d="M5 19.5C5.5 18 6 15 6 12c0-2.8 2-5 4.5-5C13 7 15 9 15 12c0 1.5-.5 3-1.5 4" />
                    <path d="M12 12a1 1 0 1 0 0 2 1 1 0 0 0 0-2z" />
                    <path d="M8.5 16.5C9 15 9 14 9 12a3 3 0 0 1 6 0c0 2-.5 4-2 6" />
                    <path d="M20 4v4h-4" />
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

              {/* Submit */}
              <button type="submit" className="admin-login-submit">
                Entrar
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
