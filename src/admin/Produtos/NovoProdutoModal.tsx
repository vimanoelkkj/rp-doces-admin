import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import type { ProdutoAdmin } from "./AdminProdutos";
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

interface Categoria {
  id: string;
  nome: string;
  emoji: string;
  ativo: number;
}

// Mapeia o ícone escolhido (SVG) para um emoji de verdade, salvo no produto
// como identificador visual enquanto não há foto.
const EMOJI_CHARS = [
  "🎂",
  "🧁",
  "🍮",
  "🎉",
  "🍓",
  "🍫",
  "🥥",
  "🍋",
  "🍯",
  "🍪",
];

const R2_IMAGE_KEY_PATTERN = /^product-\d+-[0-9a-f-]+\.(?:jpg|png|webp)$/i;

// Fotos enviadas pelo novo upload (R2) seguem o padrão `product-{id}-{uuid}.ext`
// e são servidas via /api/images/:key; fotos de seed antigas são arquivos
// estáticos servidos direto de /images/:nome.
export function imageUrlFor(key: string | null): string | null {
  if (!key) return null;
  return R2_IMAGE_KEY_PATTERN.test(key)
    ? `/api/images/${encodeURIComponent(key)}`
    : `/images/${key}`;
}

interface NovoProdutoModalProps {
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
  produto?: ProdutoAdmin | null;
}

export default function NovoProdutoModal({
  open,
  onClose,
  onSaved,
  produto,
}: NovoProdutoModalProps) {
  const isEdit = produto != null;
  const [name, setName] = useState("");
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [category, setCategory] = useState("");
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!isEdit) {
      // Sem id ainda (produto novo): só preview local, upload de verdade
      // só é possível depois que o produto existir (mesmo padrão do backend).
      const reader = new FileReader();
      reader.onloadend = () => setImagePreview(reader.result as string);
      reader.readAsDataURL(file);
      return;
    }

    setUploadingImage(true);
    setError(null);
    const formData = new FormData();
    formData.append("image", file);
    fetch(`/api/admin/produtos/${produto!.id}/imagem`, {
      method: "POST",
      body: formData,
    })
      .then(async (response) => {
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.error ?? "Falha ao enviar imagem");
        }
        return response.json() as Promise<{ imageUrl: string }>;
      })
      .then((result) => {
        setImagePreview(result.imageUrl);
        onSaved?.();
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Falha ao enviar imagem");
      })
      .finally(() => setUploadingImage(false));
  };

  const handleRemoveImage = () => {
    if (!isEdit || uploadingImage) return;
    setUploadingImage(true);
    setError(null);
    fetch(`/api/admin/produtos/${produto!.id}/imagem`, { method: "DELETE" })
      .then(async (response) => {
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.error ?? "Falha ao remover imagem");
        }
        setImagePreview(null);
        onSaved?.();
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Falha ao remover imagem");
      })
      .finally(() => setUploadingImage(false));
  };

  const resetForm = () => {
    setName("");
    setCategory(categorias[0]?.id ?? "");
    setStock(0);
    setSelectedEmoji(null);
    setPrice("0,00");
    setDescription("");
    setImagePreview(null);
    setProdutoAtivo(true);
    setDisponivelVenda(true);
    setDestaque(false);
    setPromocao(false);
    setError(null);
  };

  useEffect(() => {
    if (!open) return;
    fetch("/api/admin/categorias")
      .then(async (response) => {
        if (!response.ok) throw new Error("Falha ao carregar categorias");
        return response.json() as Promise<{ categorias: Categoria[] }>;
      })
      .then((data) => {
        setCategorias(data.categorias);
        setCategory((current) => current || data.categorias[0]?.id || "");
      })
      .catch(() => setCategorias([]));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (!produto) {
      resetForm();
      return;
    }
    setName(produto.nome);
    setCategory(produto.categoria);
    setStock(produto.estoque);
    const emojiIndex = EMOJI_CHARS.indexOf(produto.emoji);
    setSelectedEmoji(emojiIndex >= 0 ? emojiIndex : null);
    setPrice((produto.preco_centavos / 100).toFixed(2).replace(".", ","));
    setDescription(produto.descricao);
    setImagePreview(imageUrlFor(produto.image_key));
    setProdutoAtivo(produto.ativo === 1);
    setDisponivelVenda(produto.disponivel === 1);
    setDestaque(produto.destaque === 1);
    setPromocao(produto.promocao_ativa === 1);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, produto]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;

    const precoCentavos = Math.round(
      parseFloat(price.replace(",", ".")) * 100,
    );
    if (!Number.isFinite(precoCentavos) || precoCentavos < 1) {
      setError("Informe um preço válido.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const url = isEdit
        ? `/api/admin/produtos/${produto!.id}`
        : "/api/admin/produtos";
      const response = await fetch(url, {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome: name,
          categoria: category,
          descricao: description,
          precoCentavos,
          estoque: stock,
          emoji: selectedEmoji != null ? EMOJI_CHARS[selectedEmoji] : "",
          ativo: produtoAtivo,
          disponivel: disponivelVenda,
          destaque,
          promocaoAtiva: promocao,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || "Falha ao salvar produto");
      }
      resetForm();
      onSaved?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao salvar produto");
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return createPortal(
    <div className="np-overlay" onClick={onClose}>
      <div className="np-modal" onClick={(e) => e.stopPropagation()}>
        <div className="np-header">
          <div>
            <span className="np-kicker">CATÁLOGO</span>
            <h2 className="np-title">
              {isEdit ? "Editar produto" : "Novo produto"}
            </h2>
            <p className="np-subtitle">
              {isEdit
                ? "Atualize as informações deste doce no catálogo."
                : "Cadastre um doce e ele já entra no catálogo administrativo."}
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
                  <span>
                    {categorias.find((c) => c.id === category)
                      ? `${categorias.find((c) => c.id === category)!.emoji} ${categorias.find((c) => c.id === category)!.nome}`
                      : "Selecione uma categoria"}
                  </span>
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
                    {categorias
                      .filter((cat) => cat.ativo === 1 || cat.id === category)
                      .map((cat) => (
                        <li key={cat.id}>
                          <button
                            type="button"
                            className={`np-dropdown-option ${category === cat.id ? "np-dropdown-option--active" : ""}`}
                            onClick={() => {
                              setCategory(cat.id);
                              setCatOpen(false);
                            }}
                          >
                            {cat.emoji} {cat.nome}
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
                  <span className="np-photo-empty">
                    {uploadingImage ? "Enviando…" : "Sem foto"}
                  </span>
                )}
              </div>
              <div className="np-photo-info">
                <button
                  type="button"
                  className="np-photo-btn"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploadingImage}
                >
                  {uploadingImage ? "ENVIANDO…" : "ESCOLHER FOTO"}
                </button>
                {isEdit && imagePreview && (
                  <button
                    type="button"
                    className="np-photo-remove"
                    onClick={handleRemoveImage}
                    disabled={uploadingImage}
                  >
                    REMOVER FOTO
                  </button>
                )}
                <p className="np-photo-hint">
                  {isEdit
                    ? "JPG, PNG ou WebP, até 5 MB."
                    : "Salve o produto primeiro para poder enviar uma foto."}
                </p>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
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

          {error && <p className="np-error">{error}</p>}

          <div className="np-footer">
            <button type="button" className="np-btn-cancel" onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="np-btn-save" disabled={saving}>
              {saving
                ? "Salvando…"
                : isEdit
                  ? "Salvar alterações"
                  : "Salvar produto"}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
