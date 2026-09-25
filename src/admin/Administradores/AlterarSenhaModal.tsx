import { useState } from "react";
import { createPortal } from "react-dom";
import { useAdminModal } from "../components/useAdminModal";
import "./NovoAdminModal.css";

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

interface AlterarSenhaModalProps {
  adminId: number | null;
  adminNome: string;
  isSelf: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export default function AlterarSenhaModal({
  adminId,
  adminNome,
  isSelf,
  onClose,
  onSaved,
}: AlterarSenhaModalProps) {
  const [senhaAtual, setSenhaAtual] = useState("");
  const [senha, setSenha] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClose = () => {
    setSenhaAtual("");
    setSenha("");
    setConfirmar("");
    setError(null);
    onClose();
  };

  const modalProps = useAdminModal(adminId != null, handleClose);

  const senhasIguais = senha === confirmar;
  const canSubmit = isSelf
    ? senhaAtual.trim().length > 0 && senha.length >= 8 && senhasIguais
    : senha.length >= 8 && senhasIguais;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || saving || adminId == null) return;

    setSaving(true);
    setError(null);

    const payload: { acao: string; senha: string; senhaAtual?: string } = {
      acao: "resetar_senha",
      senha,
    };
    if (isSelf) {
      payload.senhaAtual = senhaAtual;
    }

    fetch(`/api/admin/administradores/${adminId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(async (response) => {
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.error ?? "Falha ao alterar senha");
        }
        setSenhaAtual("");
        setSenha("");
        setConfirmar("");
        setError(null);
        onSaved();
        onClose();
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Falha ao alterar senha");
      })
      .finally(() => setSaving(false));
  };

  if (adminId == null) return null;

  return createPortal(
    <div className="nadm-overlay" {...modalProps}>
      <div className="nadm-modal">
        <div className="nadm-header">
          <div>
            <span className="nadm-kicker">EQUIPE</span>
            <h2 className="nadm-title">Alterar senha</h2>
            <p className="nadm-subtitle">
              {isSelf
                ? "Altere a senha da sua conta."
                : `Nova senha para ${adminNome}.`}
            </p>
          </div>
          <button className="nadm-close" onClick={handleClose}>
            <IconClose />
          </button>
        </div>

        <form className="nadm-body" onSubmit={handleSubmit}>
          {isSelf && (
            <div className="nadm-field">
              <label>SENHA ATUAL</label>
              <input
                type="password"
                placeholder="Sua senha atual"
                value={senhaAtual}
                onChange={(e) => setSenhaAtual(e.target.value)}
                autoFocus
              />
            </div>
          )}

          <div className="nadm-field">
            <label>NOVA SENHA</label>
            <input
              type="password"
              placeholder="Mín. 8 caracteres"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              autoFocus={!isSelf}
            />
          </div>

          <div className="nadm-field">
            <label>{isSelf ? "CONFIRMAR NOVA SENHA" : "CONFIRMAR SENHA"}</label>
            <input
              type="password"
              placeholder={isSelf ? "Repita a nova senha" : "Repita a senha"}
              value={confirmar}
              onChange={(e) => setConfirmar(e.target.value)}
              className={confirmar && !senhasIguais ? "nadm-input--error" : ""}
            />
            {confirmar && !senhasIguais && (
              <span className="nadm-error-text">As senhas não coincidem</span>
            )}
          </div>

          {error && <p className="nadm-error-text">{error}</p>}

          <div className="nadm-footer">
            <button
              type="button"
              className="nadm-btn-cancel"
              onClick={handleClose}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="nadm-btn-save"
              disabled={!canSubmit || saving}
            >
              {saving ? "Salvando…" : "Salvar nova senha"}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
