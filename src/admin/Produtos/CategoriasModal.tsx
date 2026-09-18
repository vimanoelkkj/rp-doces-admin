import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useAdminModal } from "../components/useAdminModal";
import { EMOJI_OPTIONS } from "./EmojiIcons";
import "./CategoriasModal.css";

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

/* ── Types (espelham o retorno de GET /api/admin/categorias) ── */
interface Category {
  id: string;
  nome: string;
  emoji: string;
  descricao: string;
  sistema: number;
  total_produtos: number;
  produtos_ativos: number;
  produtos_arquivados: number;
}

interface CategoriasModalProps {
  open: boolean;
  onClose: () => void;
}

/* ── Component ── */
export default function CategoriasModal({
  open,
  onClose,
}: CategoriasModalProps) {
  const modalProps = useAdminModal(open, onClose);
  const [categories, setCategories] = useState<Category[]>([]);
  const [newName, setNewName] = useState("");
  const [newEmoji, setNewEmoji] = useState(EMOJI_OPTIONS[0].char);
  const [newDescription, setNewDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const carregarCategorias = () => {
    fetch("/api/admin/categorias")
      .then(async (response) => {
        if (!response.ok) throw new Error("Falha ao carregar categorias");
        return response.json() as Promise<{ categorias: Category[] }>;
      })
      .then((data) => {
        setCategories(data.categorias);
        setError(null);
      })
      .catch((err) => setError(err.message));
  };

  useEffect(() => {
    if (open) carregarCategorias();
  }, [open]);

  const handleCreate = () => {
    if (!newName.trim() || saving) return;
    setSaving(true);
    setError(null);
    fetch("/api/admin/categorias", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nome: newName.trim(),
        emoji: newEmoji,
        descricao: newDescription.trim(),
      }),
    })
      .then(async (response) => {
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.error ?? "Falha ao criar categoria");
        }
        setNewName("");
        setNewDescription("");
        setNewEmoji(EMOJI_OPTIONS[0].char);
        carregarCategorias();
      })
      .catch((err) => {
        setError(
          err instanceof Error ? err.message : "Falha ao criar categoria",
        );
      })
      .finally(() => setSaving(false));
  };

  if (!open) return null;

  return createPortal(
    <div className="catm-overlay" {...modalProps}>
      <div className="catm-modal">
        {/* ── Header ── */}
        <div className="catm-header">
          <div>
            <span className="catm-kicker">CATÁLOGO</span>
            <h2 className="catm-title">Gerenciar categorias</h2>
            <p className="catm-subtitle">
              Crie categorias e use-as imediatamente nos produtos do cardápio.
            </p>
          </div>
          <button className="catm-close" onClick={onClose}>
            <IconClose />
          </button>
        </div>

        {/* ── Body ── */}
        <div className="catm-body">
          {/* Nova categoria form */}
          <div className="catm-new-card">
            <div className="catm-new-header">
              <span className="catm-new-title">Nova categoria</span>
              <span className="catm-new-hint">
                O identificador é criado automaticamente a partir do nome.
              </span>
            </div>

            {/* Nome */}
            <div className="catm-field catm-field--full">
              <label>NOME</label>
              <input
                type="text"
                placeholder="Ex.: Brownies"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>

            {/* Emoji — mesmo conjunto (e mesma UI) do modal de novo produto,
                para não divergir em quais emojis existem em cada tela. */}
            <div className="catm-field catm-field--full">
              <label>EMOJI</label>
              <div className="catm-emoji-grid">
                {EMOJI_OPTIONS.map((em) => (
                  <button
                    key={em.char}
                    type="button"
                    className={`catm-emoji-item${newEmoji === em.char ? " catm-emoji-item--active" : ""}`}
                    onClick={() => setNewEmoji(em.char)}
                  >
                    <span className="catm-emoji-icon">{em.icon}</span>
                    <span className="catm-emoji-label">{em.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Descrição */}
            <div className="catm-field catm-field--full">
              <label>DESCRIÇÃO</label>
              <input
                type="text"
                placeholder="Ex.: Brownies artesanais da R&P"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
              />
            </div>

            {error && <p className="catm-error-text">{error}</p>}

            <div className="catm-new-footer">
              <button
                type="button"
                className="catm-btn-create"
                onClick={handleCreate}
                disabled={!newName.trim() || saving}
              >
                {saving ? "Criando…" : "+ Criar categoria"}
              </button>
            </div>
          </div>

          {/* Categories list */}
          <div className="catm-list">
            {categories.map((cat) => (
              <div className="catm-cat-card" key={cat.id}>
                <div className="catm-cat-left">
                  <div className="catm-cat-emoji">{cat.emoji}</div>
                  <div className="catm-cat-info">
                    <div className="catm-cat-name-row">
                      <span className="catm-cat-name">{cat.nome}</span>
                      <span className="catm-cat-slug">{cat.id}</span>
                    </div>
                    <span className="catm-cat-desc">{cat.descricao}</span>
                    <div className="catm-cat-stats">
                      <span>
                        <strong>{cat.total_produtos}</strong> produtos
                      </span>
                      <span>
                        <strong>{cat.produtos_ativos}</strong> ativos
                      </span>
                      <span>
                        <strong>{cat.produtos_arquivados}</strong> arquivados
                      </span>
                    </div>
                  </div>
                </div>
                <span
                  className={`catm-cat-badge ${cat.sistema === 0 ? "catm-cat-badge--custom" : ""}`}
                >
                  {cat.sistema === 1 ? "Sistema" : "Personalizada"}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Footer ── */}
        <div className="catm-footer">
          <span className="catm-footer-count">
            {categories.length} categorias no catálogo
          </span>
          <button className="catm-btn-close" onClick={onClose}>
            Fechar
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
