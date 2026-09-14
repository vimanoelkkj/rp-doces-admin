import { useState, useRef } from "react";
import { createPortal } from "react-dom";
import "./NovoProdutoModal.css";
import {
  EmojiCake,
  EmojiCupcake,
  EmojiPudding,
  EmojiPartyCake,
  EmojiStrawberry,
  EmojiChocolate,
  EmojiCoconut,
  EmojiLemon,
  EmojiHoney,
  EmojiCookie,
} from "./EmojiIcons";

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

const IconMinus = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
  >
    <path d="M4 8h8" />
  </svg>
);

const IconPlus = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
  >
    <path d="M8 4v8M4 8h8" />
  </svg>
);

const EMOJIS = [
  { icon: <EmojiCake />, label: "Bolo" },
  { icon: <EmojiCupcake />, label: "Cupcake" },
  { icon: <EmojiPudding />, label: "Pudim" },
  { icon: <EmojiPartyCake />, label: "Bolo de festa" },
  { icon: <EmojiStrawberry />, label: "Morango" },
  { icon: <EmojiChocolate />, label: "Chocolate" },
  { icon: <EmojiCoconut />, label: "Coco" },
  { icon: <EmojiLemon />, label: "Limão" },
  { icon: <EmojiHoney />, label: "Mel" },
  { icon: <EmojiCookie />, label: "Biscoito" },
];

const categories = [
  "🍰 Bolos no pote",
  "🍮 Sobremesas",
  "🍫 Trufas",
  "🧁 Cupcakes",
];

interface NovoProdutoModalProps {
  open: boolean;
  onClose: () => void;
}

export default function NovoProdutoModal({
  open,
  onClose,
}: NovoProdutoModalProps) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState(categories[0]);
  const [stock, setStock] = useState(0);
  const [selectedEmoji, setSelectedEmoji] = useState<number | null>(null);
  const [price, setPrice] = useState("0,00");
  const [description, setDescription] = useState("");
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [produtoAtivo, setProdutoAtivo] = useState(true);
  const [disponivelVenda, setDisponivelVenda] = useState(true);
  const [destaque, setDestaque] = useState(false);
  const [promocao, setPromocao] = useState(false);
  const [catOpen, setCatOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setImagePreview(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onClose();
  };

  if (!open) return null;

  return createPortal(
    <div className="np-overlay" onClick={onClose}>
      <div className="np-modal" onClick={(e) => e.stopPropagation()}>
        <div className="np-header">
          <div>
            <span className="np-kicker">CATÁLOGO</span>
            <h2 className="np-title">Novo produto</h2>
            <p className="np-subtitle">
              Cadastre um doce e ele já entra no catálogo administrativo.
            </p>
          </div>
          <button className="np-close" onClick={onClose}>
            <IconClose />
          </button>
        </div>

        <form className="np-body" onSubmit={handleSubmit}>
          <div className="np-field np-field--full">
            <label>NOME</label>
            <input
              type="text"
              placeholder="Ex.: Bolo no pote de morango"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="np-row-2">
            <div className="np-field">
              <label>CATEGORIA</label>
              <div
                className={`np-dropdown ${catOpen ? "np-dropdown--open" : ""}`}
              >
                <button
                  type="button"
                  className="np-dropdown-trigger"
                  onClick={() => setCatOpen(!catOpen)}
                  onBlur={() => setTimeout(() => setCatOpen(false), 150)}
                >
                  <span>{category}</span>
                  <svg width="12" height="8" viewBox="0 0 12 8" fill="none">
                    <path
                      d="M1 1.5L6 6.5L11 1.5"
                      stroke="#634738"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
                {catOpen && (
                  <ul className="np-dropdown-list">
                    {categories.map((cat) => (
                      <li key={cat}>
                        <button
                          type="button"
                          className={`np-dropdown-option ${category === cat ? "np-dropdown-option--active" : ""}`}
                          onClick={() => {
                            setCategory(cat);
                            setCatOpen(false);
                          }}
                        >
                          {cat}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div className="np-field">
              <label>ESTOQUE</label>
              <div className="np-stepper">
                <button
                  type="button"
                  className="np-stepper-btn"
                  onClick={() => setStock(Math.max(0, stock - 1))}
                >
                  <IconMinus />
                </button>
                <span className="np-stepper-value">{stock}</span>
                <button
                  type="button"
                  className="np-stepper-btn"
                  onClick={() => setStock(stock + 1)}
                >
                  <IconPlus />
                </button>
              </div>
            </div>
          </div>

          <div className="np-field np-field--full">
            <label>EMOJI</label>
            <div className="np-emoji-grid">
              {EMOJIS.map((e, i) => (
                <button
                  key={i}
                  type="button"
                  className={`np-emoji-item${selectedEmoji === i ? " np-emoji-item--active" : ""}`}
                  onClick={() => setSelectedEmoji(i)}
                >
                  <span className="np-emoji-icon">{e.icon}</span>
                  <span className="np-emoji-label">{e.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="np-field np-field--full">
            <label>PREÇO</label>
            <input
              type="text"
              placeholder="0,00"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </div>

          <div className="np-field np-field--full">
            <label>FOTO DO PRODUTO</label>
            <div className="np-photo-row">
              <div
                className="np-photo-preview"
                onClick={() => fileRef.current?.click()}
              >
                {imagePreview ? (
                  <img src={imagePreview} alt="Preview" />
                ) : (
                  <span className="np-photo-empty">Sem foto</span>
                )}
              </div>
              <div className="np-photo-info">
                <button
                  type="button"
                  className="np-photo-btn"
                  onClick={() => fileRef.current?.click()}
                >
                  ESCOLHER FOTO
                </button>
                <p className="np-photo-hint">
                  A prévia usa o enquadramento do card do site. A foto é
                  redimensionada automaticamente e enviada em WebP.
                </p>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                onChange={handleImageChange}
                hidden
              />
            </div>
          </div>

          <div className="np-field np-field--full">
            <label>DESCRIÇÃO</label>
            <textarea
              placeholder="Uma descrição curta do produto."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
            />
          </div>

          <div className="np-checks-grid">
            <label className="np-check">
              <input
                type="checkbox"
                checked={produtoAtivo}
                onChange={(e) => setProdutoAtivo(e.target.checked)}
              />
              <span className="np-check-box" />
              <div>
                <strong>Produto ativo</strong>
                <span>Disponível para aparecer no catálogo.</span>
              </div>
            </label>
            <label className="np-check">
              <input
                type="checkbox"
                checked={destaque}
                onChange={(e) => setDestaque(e.target.checked)}
              />
              <span className="np-check-box" />
              <div>
                <strong>Marcar como destaque</strong>
                <span>Exibe o selo de destaque no produto.</span>
              </div>
            </label>
            <label className="np-check">
              <input
                type="checkbox"
                checked={disponivelVenda}
                onChange={(e) => setDisponivelVenda(e.target.checked)}
              />
              <span className="np-check-box" />
              <div>
                <strong>Disponível para venda</strong>
                <span>Controla a disponibilidade sem arquivar.</span>
              </div>
            </label>
            <label className="np-check">
              <input
                type="checkbox"
                checked={promocao}
                onChange={(e) => setPromocao(e.target.checked)}
              />
              <span className="np-check-box" />
              <div>
                <strong>Promoção</strong>
                <span>Ativa preço promocional e agendamento.</span>
              </div>
            </label>
          </div>

          <div className="np-footer">
            <button type="button" className="np-btn-cancel" onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="np-btn-save">
              Salvar produto
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
