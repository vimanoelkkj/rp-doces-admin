import { useEffect, useRef, useState } from "react";
import {
  createProduct,
  listCategories,
  ProductApiError,
  updateProduct,
  uploadProductImage,
  type Category
} from "./product.api";
import { ProductInputSchema } from "./product.schema";
import type { Product, ProductId, ProductInput } from "./product.types";
import {
  ProductImageEditor,
  type ProductImageEditorHandle
} from "./ProductImageEditor";
import styles from "./ProductDialog.module.css";

interface Props {
  product: Product | null;
  onClose: () => void;
  onSaved: () => void;
}

const EMOJI_OPTIONS = ["🍰", "🧁", "🍮", "🎂", "🍓", "🍫", "🥥", "🍋", "🍯", "🍪"];

const empty = (): ProductInput => ({
  nome: "",
  categoria: "",
  descricao: "",
  preco_centavos: 0,
  disponivel: true,
  ativo: true,
  destaque: false,
  emoji: "🍰",
  estoque: 0,
  promocao_ativa: false,
  preco_promocional_centavos: null,
  promocao_inicio: null,
  promocao_fim: null
});

const fromProduct = (product: Product): ProductInput => ({
  nome: product.nome,
  categoria: product.categoria,
  descricao: product.descricao,
  preco_centavos: product.preco_centavos,
  disponivel: product.disponivel,
  ativo: product.ativo,
  destaque: product.destaque,
  emoji: product.emoji ?? "",
  estoque: product.estoque,
  promocao_ativa: product.promocao_ativa,
  preco_promocional_centavos: product.preco_promocional_centavos,
  promocao_inicio: product.promocao_inicio,
  promocao_fim: product.promocao_fim
});

function toLocalDateTime(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function fromLocalDateTime(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function ProductDialog({ product, onClose, onSaved }: Props) {
  const [form, setForm] = useState<ProductInput>(product ? fromProduct(product) : empty());
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoriesLoaded, setCategoriesLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdProductId, setCreatedProductId] = useState<ProductId | null>(null);
  const imageEditorRef = useRef<ProductImageEditorHandle>(null);
  const reservedStock = product?.estoque_reservado ?? 0;
  const availableStock = Math.max(0, form.estoque - reservedStock);
  const productUsesUnavailableCategory = Boolean(
    product && categoriesLoaded && !categories.some(category => category.id === product.categoria)
  );

  useEffect(() => {
    setCategoriesLoaded(false);
    listCategories()
      .then(items => {
        setCategories(items);
        setCategoriesLoaded(true);

        if (!product && items[0]) {
          setForm(current => ({
            ...current,
            categoria: current.categoria || items[0].id
          }));
        }
      })
      .catch(() => {
        setCategoriesLoaded(true);
        setError("Não foi possível carregar as categorias.");
      });
  }, [product]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const parsed = ProductInputSchema.safeParse(form);

    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message || "Revise os dados do produto.");
      return;
    }

    if (productUsesUnavailableCategory && parsed.data.categoria === product?.categoria) {
      setError("A categoria atual está inativa. Escolha uma categoria ativa antes de salvar.");
      return;
    }

    if (product && parsed.data.estoque < reservedStock) {
      setError(
        `O estoque total não pode ser menor que ${reservedStock}, pois ${reservedStock} unidade(s) estão reservadas em compras pendentes.`
      );
      return;
    }

    setSaving(true);
    let targetId = product?.id ?? createdProductId;
    let productPersisted = false;
    let preparedImage: File | null = null;

    try {
      preparedImage = await imageEditorRef.current?.prepareCurrentImage() ?? null;

      if (product) {
        await updateProduct(product.id, parsed.data);
        targetId = product.id;
      } else if (createdProductId) {
        await updateProduct(createdProductId, parsed.data);
        targetId = createdProductId;
      } else {
        targetId = await createProduct(parsed.data);
        setCreatedProductId(targetId);
      }

      productPersisted = true;

      if (preparedImage && targetId) {
        await uploadProductImage(targetId, preparedImage);
      }

      onSaved();
    } catch (err) {
      const message = err instanceof ProductApiError ? err.message : err instanceof Error ? err.message : "Não foi possível salvar o produto.";

      if (productPersisted && preparedImage) {
        setError(`Produto salvo, mas a foto não foi enviada: ${message} Tente salvar novamente.`);
      } else {
        setError(message);
      }
    } finally {
      setSaving(false);
    }
  }

  const imageProductId = product?.id ?? createdProductId;

  return (
    <div
      className={styles.overlay}
      role="presentation"
      onMouseDown={event => event.target === event.currentTarget && onClose()}
    >
      <section
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="product-title"
      >
        <header>
          <div>
            <small>Catálogo</small>
            <h2 id="product-title">{product ? "Editar produto" : "Novo produto"}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar">
            ×
          </button>
        </header>

        <ProductImageEditor
          ref={imageEditorRef}
          productId={imageProductId}
          currentImageKey={product?.image_key ?? null}
        />

        <form onSubmit={submit} className={styles.form} autoComplete="off">
          <label>
            Nome
            <input
              value={form.nome}
              maxLength={100}
              onChange={event => setForm({ ...form, nome: event.target.value })}
            />
          </label>

          <label>
            Categoria
            <select
              value={form.categoria}
              onChange={event => setForm({ ...form, categoria: event.target.value })}
            >
              {productUsesUnavailableCategory && product && (
                <option value={product.categoria} disabled>
                  {product.categoria_emoji ?? ""} {product.categoria_nome || product.categoria} (inativa)
                </option>
              )}
              {categories.map(category => (
                <option key={category.id} value={category.id}>
                  {category.emoji} {category.nome}
                </option>
              ))}
            </select>
            {productUsesUnavailableCategory && (
              <small>A categoria atual foi desativada. Escolha outra categoria para salvar alterações.</small>
            )}
          </label>

          <label>
            Preço (R$)
            <input
              inputMode="decimal"
              type="number"
              min="0.01"
              max="100000"
              step="0.01"
              value={form.preco_centavos ? form.preco_centavos / 100 : ""}
              onChange={event =>
                setForm({
                  ...form,
                  preco_centavos: Math.round(Number(event.target.value) * 100)
                })
              }
            />
          </label>

          <label>
            Estoque total
            <input
              type="number"
              min={reservedStock}
              max="100000"
              step="1"
              value={form.estoque}
              onChange={event => setForm({ ...form, estoque: Number(event.target.value) })}
            />
            {product && reservedStock > 0 ? (
              <small className={styles.stockHelp}>
                <strong>{reservedStock} reservada(s)</strong> em compras pendentes · {availableStock} disponível(is)
              </small>
            ) : null}
          </label>

          <fieldset className={`${styles.wide} ${styles.emojiField}`}>
            <legend>Emoji</legend>
            <div className={styles.emojiGrid} role="radiogroup" aria-label="Emoji do produto">
              {EMOJI_OPTIONS.map(emoji => (
                <button
                  key={emoji}
                  type="button"
                  role="radio"
                  aria-checked={form.emoji === emoji}
                  className={form.emoji === emoji ? styles.emojiSelected : ""}
                  onClick={() => setForm({ ...form, emoji })}
                >
                  {emoji}
                </button>
              ))}
              <button
                type="button"
                role="radio"
                aria-checked={form.emoji === ""}
                className={form.emoji === "" ? styles.emojiSelected : ""}
                onClick={() => setForm({ ...form, emoji: "" })}
              >
                Sem emoji
              </button>
            </div>
          </fieldset>

          <label className={styles.wide}>
            Descrição
            <textarea
              maxLength={500}
              rows={4}
              value={form.descricao}
              onChange={event => setForm({ ...form, descricao: event.target.value })}
            />
          </label>

          <div className={`${styles.wide} ${styles.toggleGrid}`}>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={form.ativo}
                onChange={event => setForm({ ...form, ativo: event.target.checked })}
              />
              <span>
                <strong>Produto ativo</strong>
                <small>Desmarque para arquivar o produto.</small>
              </span>
            </label>

            <label className={styles.check}>
              <input
                type="checkbox"
                checked={form.disponivel}
                disabled={!form.ativo}
                onChange={event => setForm({ ...form, disponivel: event.target.checked })}
              />
              <span>
                <strong>Disponível para venda</strong>
                <small>Controla a disponibilidade sem arquivar.</small>
              </span>
            </label>

            <label className={styles.check}>
              <input
                type="checkbox"
                checked={form.destaque}
                onChange={event => setForm({ ...form, destaque: event.target.checked })}
              />
              <span>
                <strong>Destaque</strong>
                <small>Exibe o selo de destaque no catálogo.</small>
              </span>
            </label>

            <label className={styles.check}>
              <input
                type="checkbox"
                checked={form.promocao_ativa}
                onChange={event =>
                  setForm({
                    ...form,
                    promocao_ativa: event.target.checked,
                    preco_promocional_centavos: event.target.checked
                      ? form.preco_promocional_centavos
                      : null,
                    promocao_inicio: event.target.checked ? form.promocao_inicio : null,
                    promocao_fim: event.target.checked ? form.promocao_fim : null
                  })
                }
              />
              <span>
                <strong>Promoção</strong>
                <small>Ativa preço promocional e agendamento.</small>
              </span>
            </label>
          </div>

          {form.promocao_ativa && (
            <section className={`${styles.wide} ${styles.promotionBox}`}>
              <div className={styles.promotionHeading}>
                <strong>Configuração da promoção</strong>
                <small>Início e fim são opcionais. Sem datas, a promoção vale imediatamente.</small>
              </div>

              <div className={styles.promotionGrid}>
                <label>
                  Preço promocional (R$)
                  <input
                    inputMode="decimal"
                    type="number"
                    min="0.01"
                    max={Math.max(0.01, (form.preco_centavos - 1) / 100)}
                    step="0.01"
                    value={
                      form.preco_promocional_centavos
                        ? form.preco_promocional_centavos / 100
                        : ""
                    }
                    onChange={event =>
                      setForm({
                        ...form,
                        preco_promocional_centavos: event.target.value
                          ? Math.round(Number(event.target.value) * 100)
                          : null
                      })
                    }
                  />
                </label>

                <label>
                  Início
                  <input
                    type="datetime-local"
                    value={toLocalDateTime(form.promocao_inicio)}
                    onChange={event =>
                      setForm({
                        ...form,
                        promocao_inicio: fromLocalDateTime(event.target.value)
                      })
                    }
                  />
                </label>

                <label>
                  Fim
                  <input
                    type="datetime-local"
                    value={toLocalDateTime(form.promocao_fim)}
                    onChange={event =>
                      setForm({
                        ...form,
                        promocao_fim: fromLocalDateTime(event.target.value)
                      })
                    }
                  />
                </label>
              </div>
            </section>
          )}

          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}

          <footer>
            <button type="button" onClick={onClose} disabled={saving}>
              Cancelar
            </button>
            <button type="submit" disabled={saving}>
              {saving ? "Salvando…" : "Salvar produto"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
