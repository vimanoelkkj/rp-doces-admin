import { useState } from "react";
import { createPortal } from "react-dom";
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

/* ── Types ── */
interface Category {
  name: string;
  slug: string;
  emoji: string;
  description: string;
  type: "sistema" | "personalizada";
  totalProducts: number;
  activeProducts: number;
  archivedProducts: number;
}

/* ── Mock data ── */
const INITIAL_CATEGORIES: Category[] = [
  {
    name: "Bolos no pote",
    slug: "BOLO_NO_POTE",
    emoji: "🍰",
    description: "Bolos no pote do cardápio R&P Doces.",
    type: "sistema",
    totalProducts: 4,
    activeProducts: 4,
    archivedProducts: 0,
  },
  {
    name: "Mini pudins",
    slug: "MINI_PUDIM",
    emoji: "🍮",
    description: "Mini pudins do cardápio R&P Doces.",
    type: "sistema",
    totalProducts: 1,
    activeProducts: 1,
    archivedProducts: 0,
  },
  {
    name: "Brownies",
    slug: "BROWNIES",
    emoji: "🍫",
    description: "Brownies Teste",
    type: "personalizada",
    totalProducts: 0,
    activeProducts: 0,
    archivedProducts: 0,
  },
];

const EMOJI_OPTIONS = [
  "🍰",
  "🧁",
  "🍮",
  "🍫",
  "🍪",
  "🍓",
  "🥥",
  "🍋",
  "🍯",
  "🎂",
];

interface CategoriasModalProps {
  open: boolean;
  onClose: () => void;
}

/* ── Component ── */
export default function CategoriasModal({
  open,
  onClose,
}: CategoriasModalProps) {
  const [categories, setCategories] = useState<Category[]>(INITIAL_CATEGORIES);
  const [newName, setNewName] = useState("");
  const [newEmoji, setNewEmoji] = useState("🍰");
  const [newDescription, setNewDescription] = useState("");

  const generateSlug = (name: string) =>
    name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .replace(/\s+/g, "_")
      .replace(/[^A-Z0-9_]/g, "");

  const handleCreate = () => {
    if (!newName.trim()) return;
    const newCat: Category = {
      name: newName.trim(),
      slug: generateSlug(newName),
      emoji: newEmoji,
      description: newDescription.trim(),
      type: "personalizada",
      totalProducts: 0,
      activeProducts: 0,
      archivedProducts: 0,
    };
    setCategories((prev) => [...prev, newCat]);
    setNewName("");
    setNewDescription("");
    setNewEmoji("🍰");
  };

  if (!open) return null;

  return createPortal(
    <div className="catm-overlay" onClick={onClose}>
      <div className="catm-modal" onClick={(e) => e.stopPropagation()}>
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

            {/* Nome + Emoji */}
            <div className="catm-new-row">
              <div className="catm-field catm-field--name">
                <label>NOME</label>
                <input
                  type="text"
                  placeholder="Ex.: Brownies"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
              </div>

              <div className="catm-field">
                <label>EMOJI</label>
                <div className="catm-emoji-inline-grid">
                  {EMOJI_OPTIONS.map((em) => (
                    <button
                      key={em}
                      type="button"
                      className={`catm-emoji-option ${newEmoji === em ? "catm-emoji-option--active" : ""}`}
                      onClick={() => setNewEmoji(em)}
                    >
                      {em}
                    </button>
                  ))}
                </div>
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

            <div className="catm-new-footer">
              <button
                type="button"
                className="catm-btn-create"
                onClick={handleCreate}
                disabled={!newName.trim()}
              >
                + Criar categoria
              </button>
            </div>
          </div>

          {/* Categories list */}
          <div className="catm-list">
            {categories.map((cat, i) => (
              <div className="catm-cat-card" key={i}>
                <div className="catm-cat-left">
                  <div className="catm-cat-emoji">{cat.emoji}</div>
                  <div className="catm-cat-info">
                    <div className="catm-cat-name-row">
                      <span className="catm-cat-name">{cat.name}</span>
                      <span className="catm-cat-slug">{cat.slug}</span>
                    </div>
                    <span className="catm-cat-desc">{cat.description}</span>
                    <div className="catm-cat-stats">
                      <span>
                        <strong>{cat.totalProducts}</strong> produtos
                      </span>
                      <span>
                        <strong>{cat.activeProducts}</strong> ativos
                      </span>
                      <span>
                        <strong>{cat.archivedProducts}</strong> arquivados
                      </span>
                    </div>
                  </div>
                </div>
                <span
                  className={`catm-cat-badge ${cat.type === "personalizada" ? "catm-cat-badge--custom" : ""}`}
                >
                  {cat.type === "sistema" ? "Sistema" : "Personalizada"}
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
