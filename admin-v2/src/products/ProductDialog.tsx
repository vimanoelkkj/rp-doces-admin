import { useEffect, useState } from "react";
import {
  createProduct,
  listCategories,
  ProductApiError,
  updateProduct,
  type Category
} from "./product.api";
import { ProductInputSchema } from "./product.schema";
import type { Product, ProductInput } from "./product.types";
import { ProductImageEditor } from "./ProductImageEditor";
import styles from "./ProductDialog.module.css";

interface Props {
  product: Product | null;
  onClose: () => void;
  onSaved: () => void;
}

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
  emoji: product.emoji,
  estoque: product.estoque,
  promocao_ativa: product.promocao_ativa,
  preco_promocional_centavos: product.preco_promocional_centavos,
  promocao_inicio: product.promocao_inicio,
  promocao_fim: product.promocao_fim
});

export function ProductDialog({ product, onClose, onSaved }: Props) {
  const [form, setForm] = useState<ProductInput>(product ? fromProduct(product) : empty());
  const [categories, setCategories] = useState<Category[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listCategories()
      .then(items => {
        setCategories(items);

        if (!product && items[0]) {
          setForm(current => ({
            ...current,
            categoria: current.categoria || items[0].id
          }));
        }
      })
      .catch(() => setError("Não foi possível carregar as categorias."));
  }, [product]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const parsed = ProductInputSchema.safeParse(form);

    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message || "Revise os dados do produto.");
      return;
    }

    setSaving(true);

    try {
      if (product) {
        await updateProduct(product.id, parsed.data);
      } else {
        await createProduct(parsed.data);
      }

      onSaved();
    } catch (err) {
      setError(err instanceof ProductApiError ? err.message : "Não foi possível salvar o produto.");
    } finally {
      setSaving(false);
    }
  }

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

        {product && (
          <ProductImageEditor productId={product.id} currentImageKey={product.image_key} />
        )}

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
              {categories.map(category => (
                <option key={category.id} value={category.id}>
                  {category.emoji} {category.nome}
                </option>
              ))}
            </select>
          </label>

          <label>
            Preço (R$)
            <input
              inputMode="decimal"
              type="number"
              min="0.01"
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
            Estoque
            <input
              type="number"
              min="0"
              max="100000"
              step="1"
              value={form.estoque}
              onChange={event => setForm({ ...form, estoque: Number(event.target.value) })}
            />
          </label>

          <label className={styles.wide}>
            Descrição
            <textarea
              maxLength={500}
              rows={4}
              value={form.descricao}
              onChange={event => setForm({ ...form, descricao: event.target.value })}
            />
          </label>

          <label className={styles.check}>
            <input
              type="checkbox"
              checked={form.ativo}
              onChange={event =>
                setForm({
                  ...form,
                  ativo: event.target.checked,
                  disponivel: event.target.checked
                })
              }
            />
            Produto ativo
          </label>

          <label className={styles.check}>
            <input
              type="checkbox"
              checked={form.destaque}
              onChange={event => setForm({ ...form, destaque: event.target.checked })}
            />
            Destaque
          </label>

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
