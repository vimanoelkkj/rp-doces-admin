import { useState } from "react";
import { createPortal } from "react-dom";
import "./NovoAdminModal.css";

/* ── Icons ── */
const IconClose = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 18 18"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
  >
    <path d="M4.5 4.5l9 9M13.5 4.5l-9 9" />
  </svg>
);

const IconEye = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M1 10s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z" />
    <circle cx="10" cy="10" r="3" />
  </svg>
);

const IconEyeOff = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M1 10s3.5-6 9-6c1.5 0 2.8.4 4 1M19 10s-3.5 6-9 6c-1.5 0-2.8-.4-4-1" />
    <path d="M8.5 8.5a2.5 2.5 0 003.5 3.5" />
    <path d="M2 2l16 16" />
  </svg>
);

const IconChevron = () => (
  <svg width="12" height="8" viewBox="0 0 12 8" fill="none">
    <path
      d="M1 1.5L6 6.5L11 1.5"
      stroke="#634738"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/* ── Types ── */
interface NovoAdminModalProps {
  open: boolean;
  onClose: () => void;
}

const LEVELS = ["Mestre", "Administrador"] as const;

export default function NovoAdminModal({ open, onClose }: NovoAdminModalProps) {
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [level, setLevel] = useState<string>(LEVELS[0]);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [levelOpen, setLevelOpen] = useState(false);

  const passwordsMatch = password === confirmPassword;
  const canSubmit =
    name.trim() &&
    handle.trim() &&
    email.trim() &&
    password.length >= 6 &&
    passwordsMatch;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    // TODO: integrar com backend
    onClose();
  };

  if (!open) return null;

  return createPortal(
    <div className="nadm-overlay" onClick={onClose}>
      <div className="nadm-modal" onClick={(e) => e.stopPropagation()}>
        {/* ── Header ── */}
        <div className="nadm-header">
          <div>
            <span className="nadm-kicker">EQUIPE</span>
            <h2 className="nadm-title">Novo administrador</h2>
            <p className="nadm-subtitle">
              Crie uma conta para um novo membro da equipe.
            </p>
          </div>
          <button className="nadm-close" onClick={onClose}>
            <IconClose />
          </button>
        </div>

        {/* ── Form ── */}
        <form className="nadm-body" onSubmit={handleSubmit}>
          {/* Nome completo */}
          <div className="nadm-field">
            <label>NOME COMPLETO</label>
            <input
              type="text"
              placeholder="Ex.: Maria Silva"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          {/* Handle + Nível */}
          <div className="nadm-row-2">
            <div className="nadm-field">
              <label>HANDLE</label>
              <div className="nadm-input-prefix-wrap">
                <span className="nadm-input-prefix">@</span>
                <input
                  type="text"
                  placeholder="usuario"
                  value={handle}
                  onChange={(e) =>
                    setHandle(e.target.value.replace(/\s/g, "").toLowerCase())
                  }
                  className="nadm-input-with-prefix"
                />
              </div>
            </div>

            <div className="nadm-field">
              <label>NÍVEL DE ACESSO</label>
              <div
                className={`nadm-dropdown ${levelOpen ? "nadm-dropdown--open" : ""}`}
              >
                <button
                  type="button"
                  className="nadm-dropdown-trigger"
                  onClick={() => setLevelOpen(!levelOpen)}
                  onBlur={() => setTimeout(() => setLevelOpen(false), 150)}
                >
                  <span>{level}</span>
                  <IconChevron />
                </button>
                {levelOpen && (
                  <ul className="nadm-dropdown-list">
                    {LEVELS.map((lv) => (
                      <li key={lv}>
                        <button
                          type="button"
                          className={`nadm-dropdown-option ${level === lv ? "nadm-dropdown-option--active" : ""}`}
                          onClick={() => {
                            setLevel(lv);
                            setLevelOpen(false);
                          }}
                        >
                          {lv}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>

          {/* E-mail */}
          <div className="nadm-field">
            <label>E-MAIL</label>
            <input
              type="email"
              placeholder="email@exemplo.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          {/* Senha + Confirmar senha */}
          <div className="nadm-row-2">
            <div className="nadm-field">
              <label>SENHA</label>
              <div className="nadm-input-password-wrap">
                <input
                  type={showPassword ? "text" : "password"}
                  placeholder="Mínimo 6 caracteres"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  className="nadm-eye-btn"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <IconEyeOff /> : <IconEye />}
                </button>
              </div>
            </div>

            <div className="nadm-field">
              <label>CONFIRMAR SENHA</label>
              <div className="nadm-input-password-wrap">
                <input
                  type={showConfirm ? "text" : "password"}
                  placeholder="Repita a senha"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className={
                    confirmPassword && !passwordsMatch
                      ? "nadm-input--error"
                      : ""
                  }
                />
                <button
                  type="button"
                  className="nadm-eye-btn"
                  onClick={() => setShowConfirm(!showConfirm)}
                >
                  {showConfirm ? <IconEyeOff /> : <IconEye />}
                </button>
              </div>
              {confirmPassword && !passwordsMatch && (
                <span className="nadm-error-text">As senhas não coincidem</span>
              )}
            </div>
          </div>

          {/* Info box */}
          <div className="nadm-info-box">
            <svg
              width="16"
              height="16"
              viewBox="0 0 20 20"
              fill="none"
              stroke="#634738"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="10" cy="10" r="8" />
              <path d="M10 9v5M10 6.5v0" />
            </svg>
            <p>
              O novo administrador receberá um e-mail com as credenciais de
              acesso. Recomendamos que altere a senha no primeiro login.
            </p>
          </div>

          {/* Footer */}
          <div className="nadm-footer">
            <button type="button" className="nadm-btn-cancel" onClick={onClose}>
              Cancelar
            </button>
            <button
              type="submit"
              className="nadm-btn-save"
              disabled={!canSubmit}
            >
              Criar conta
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
