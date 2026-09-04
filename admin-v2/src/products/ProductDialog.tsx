import { useEffect, useRef, useState } from "react";
import { DateTimeField } from "../shared/DateTimeField";
import { MoneyInput } from "../shared/MoneyInput";
import { usePageScrollLock } from "../shared/usePageScrollLock";
import { CategorySelect, type CategorySelectOption } from "./CategorySelect";
import {
  createProduct,
  deleteProductImage,
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
  type PreparedImageChange,
  type ProductImageEditorHandle
} from "./ProductImageEditor";
import styles from "./ProductDialog.module.css";

interface Props {
  product: Product | null;
  onClose: () => void;
  onSaved: () => void;
  onImageChanged?: () => void;
  onProductPersisted?: () => void;
}

const EMOJI_OPTIONS = [
  ["🍰", "Bolo"],
  ["🧁", "Cupcake"],
  ["🍮", "Pudim"],
  ["🎂", "Bolo de festa"],
  ["🍓", "Morango"],
  ["🍫", "Chocolate"],
  ["🥥", "Coco"],
  ["🍋", "Limão"],
  ["🍯", "Mel"],
  ["🍪", "Biscoito"]
] as const;

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

export function ProductDialog({ product, onClose, onSaved, onImageChanged, onProductPersisted }: Props) {
  const [form, setForm] = useState<ProductInput>(product ? fromProduct(product) : empty());
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoriesLoaded, setCategoriesLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [formDirty, setFormDirty] = useState(false);
  const [imagePending, setImagePending] = useState(false);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const [reloadAfterDiscard, setReloadAfterDiscard] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdProductId, setCreatedProductId] = useState<ProductId | null>(null);
  const imageEditorRef = useRef<ProductImageEditorHandle>(null);
  const skipNextUnloadRef = useRef(false);
  const reservedStock = product?.estoque_reservado ?? 0;
  const availableStock = Math.max(0, form.estoque - reservedStock);
  const operationBusy = saving || imageBusy;
  const hasUnsavedChanges = formDirty || imagePending;
  const productUsesUnavailableCategory = Boolean(
    product && categoriesLoaded && !categories.some(category => category.id === product.categoria)
  );
  const categoryOptions: CategorySelectOption[] = [
    ...(productUsesUnavailableCategory && product
      ? [{
          value: product.categoria,
          label: `${product.categoria_emoji ?? ""} ${product.categoria_nome || product.categoria} (inativa)`.trim(),
          disabled: true
        }]
      : []),
    ...categories.map(category => ({ value: category.id, label: `${category.emoji} ${category.nome}`.trim() }))
  ];

  usePageScrollLock(true);

  useEffect(() => {
    setCategoriesLoaded(false);
    listCategories()
      .then(items => {
        setCategories(items);
        setCategoriesLoaded(true);
        if (!product && items[0]) {
          setForm(current => ({ ...current, categoria: current.categoria || items[0].id }));
        }
      })
      .catch(() => {
        setCategoriesLoaded(true);
        setError("Não foi possível carregar as categorias.");
      });
  }, [product]);

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (skipNextUnloadRef.current) return;
      event.preventDefault();
      event.returnValue = true;
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedChanges]);

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const handleReloadShortcut = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const isReload = event.key === "F5" || ((event.ctrlKey || event.metaKey) && key === "r");
      if (!isReload) return;
      event.preventDefault();
      event.stopPropagation();
      setReloadAfterDiscard(true);
      setConfirmingDiscard(true);
    };
    window.addEventListener("keydown", handleReloadShortcut, true);
    return () => window.removeEventListener("keydown", handleReloadShortcut, true);
  }, [hasUnsavedChanges]);

  function requestClose() {
    if (operationBusy) return;
    if (hasUnsavedChanges) {
      setReloadAfterDiscard(false);
      setConfirmingDiscard(true);
      return;
    }
    onClose();
  }

  function continueEditing() {
    setReloadAfterDiscard(false);
    setConfirmingDiscard(false);
  }

  function discardChanges() {
    if (reloadAfterDiscard) {
      skipNextUnloadRef.current = true;
      window.location.reload();
      return;
    }
    onClose();
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (confirmingDiscard) {
        continueEditing();
        return;
      }
      requestClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [confirmingDiscard, operationBusy, hasUnsavedChanges, onClose]);

  function changeStock(delta: number) {
    setFormDirty(true);
    setForm(current => ({
      ...current,
      estoque: Math.min(100000, Math.max(reservedStock, current.estoque + delta))
    }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setReloadAfterDiscard(false);
    setConfirmingDiscard(false);

    if (imageBusy) {
      setError("Aguarde a operação da imagem terminar antes de salvar o produto.");
      return;
    }

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
      setError(`O estoque total não pode ser menor que ${reservedStock}, pois ${reservedStock} unidade(s) estão reservadas em compras pendentes.`);
      return;
    }

    setSaving(true);
    let targetId = product?.id ?? createdProductId;
    let productPersisted = false;
    let imageChange: PreparedImageChange = null;

    try {
      imageChange = await imageEditorRef.current?.prepareImageChange() ?? null;
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
      setFormDirty(false);
      if (imageChange && targetId) {
        if (imageChange.kind === "upload") await uploadProductImage(targetId, imageChange.file);
        else await deleteProductImage(targetId);
      }
      onSaved();
    } catch (err) {
      const message = err instanceof ProductApiError ? err.message : err instanceof Error ? err.message : "Não foi possível salvar o produto.";
      if (productPersisted && imageChange) {
        onProductPersisted?.();
        setError(`Produto salvo, mas a foto não foi atualizada: ${message} Tente salvar novamente.`);
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
      onClick={event => {
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        event.stopPropagation();
        requestClose();
      }}
    >
      <section
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="product-title"
        onClick={event => event.stopPropagation()}
      >
        <header>
          <div>
            <small>Catálogo</small>
            <h2 id="product-title">{product ? "Editar produto" : "Novo produto"}</h2>
            <p>{product ? "Atualize os dados do produto no catálogo administrativo." : "Cadastre um doce e ele já entra no catálogo administrativo."}</p>
          </div>
          <button type="button" onClick={requestClose} aria-label="Fechar" disabled={operationBusy}>×</button>
        </header>

        {confirmingDiscard ? (
          <section className={styles.discardConfirm} role="alertdialog" aria-labelledby="discard-title">
            <div className={styles.discardConfirmText}>
              <strong id="discard-title">{reloadAfterDiscard ? "Recarregar e descartar alterações?" : "Descartar alterações?"}</strong>
              <small>{reloadAfterDiscard ? "As alterações não salvas serão perdidas se a página for recarregada." : "As alterações não salvas deste produto serão perdidas."}</small>
            </div>
            <div className={styles.discardConfirmActions}>
              <button type="button" onClick={continueEditing}>Continuar editando</button>
              <button className={styles.discardButton} type="button" onClick={discardChanges}>{reloadAfterDiscard ? "Recarregar" : "Descartar"}</button>
            </div>
          </section>
        ) : null}

        <form onSubmit={submit} onChangeCapture={() => setFormDirty(true)} className={styles.form} autoComplete="off">
          <label className={styles.wide}>
            Nome
            <input value={form.nome} maxLength={100} placeholder="Ex.: Bolo no pote de morango" onChange={event => setForm({ ...form, nome: event.target.value })} />
          </label>

          <label>
            Categoria
            <CategorySelect
              value={form.categoria}
              options={categoryOptions}
              onChange={value => {
                setFormDirty(true);
                setForm(current => ({ ...current, categoria: value }));
              }}
            />
            {productUsesUnavailableCategory && <small>A categoria atual está inativa. Escolha outra categoria para salvar alterações.</small>}
          </label>

          <label>
            Estoque
            <span className={styles.stockStepper}>
              <button type="button" aria-label="Diminuir estoque" onClick={() => changeStock(-1)} disabled={form.estoque <= reservedStock}>−</button>
              <input type="number" min={reservedStock} max="100000" step="1" value={form.estoque} onChange={event => setForm({ ...form, estoque: Number(event.target.value) })} />
              <button type="button" aria-label="Aumentar estoque" onClick={() => changeStock(1)} disabled={form.estoque >= 100000}>+</button>
            </span>
            {product && reservedStock > 0 ? <small className={styles.stockHelp}><strong>{reservedStock} reservada(s)</strong> em compras pendentes · {availableStock} disponível(is)</small> : null}
          </label>

          <fieldset className={`${styles.wide} ${styles.emojiField}`}>
            <legend>Emoji</legend>
            <div className={styles.emojiGrid} role="radiogroup" aria-label="Emoji do produto">
              {EMOJI_OPTIONS.map(([emoji, label]) => (
                <button
                  key={emoji}
                  type="button"
                  role="radio"
                  aria-checked={form.emoji === emoji}
                  className={form.emoji === emoji ? styles.emojiSelected : ""}
                  onClick={() => {
                    setFormDirty(true);
                    setForm({ ...form, emoji });
                  }}
                >
                  <span>{emoji}</span>
                  <small>{label}</small>
                </button>
              ))}
            </div>
          </fieldset>

          <label className={styles.wide}>
            Preço
            <MoneyInput
              valueCents={form.preco_centavos || null}
              minCents={1}
              maxCents={10_000_000}
              onValueCentsChange={value => {
                setFormDirty(true);
                setForm(current => ({ ...current, preco_centavos: value ?? 0 }));
              }}
            />
          </label>

          <div className={`${styles.wide} ${styles.imageField}`}>
            <ProductImageEditor
              ref={imageEditorRef}
              productId={imageProductId}
              currentImageKey={product?.image_key ?? null}
              onImageChanged={onImageChanged}
              onBusyChange={setImageBusy}
              onPendingChange={setImagePending}
            />
          </div>

          <label className={styles.wide}>
            Descrição
            <textarea maxLength={500} rows={4} placeholder="Uma descrição curta do produto." value={form.descricao} onChange={event => setForm({ ...form, descricao: event.target.value })} />
          </label>

          <div className={`${styles.wide} ${styles.toggleGrid}`}>
            <label className={styles.check}>
              <input type="checkbox" checked={form.ativo} onChange={event => setForm({ ...form, ativo: event.target.checked, disponivel: event.target.checked ? form.disponivel : false })} />
              <span><strong>Produto ativo</strong><small>Disponível para aparecer no catálogo.</small></span>
            </label>

            <label className={styles.check}>
              <input type="checkbox" checked={form.destaque} onChange={event => setForm({ ...form, destaque: event.target.checked })} />
              <span><strong>Marcar como destaque</strong><small>Exibe o selo de destaque no produto.</small></span>
            </label>

            <label className={styles.check}>
              <input type="checkbox" checked={form.disponivel} disabled={!form.ativo} onChange={event => setForm({ ...form, disponivel: event.target.checked })} />
              <span><strong>Disponível para venda</strong><small>Controla a disponibilidade sem arquivar.</small></span>
            </label>

            <label className={styles.check}>
              <input type="checkbox" checked={form.promocao_ativa} onChange={event => setForm({
                ...form,
                promocao_ativa: event.target.checked,
                preco_promocional_centavos: event.target.checked ? form.preco_promocional_centavos : null,
                promocao_inicio: event.target.checked ? form.promocao_inicio : null,
                promocao_fim: event.target.checked ? form.promocao_fim : null
              })} />
              <span><strong>Promoção</strong><small>Ativa preço promocional e agendamento.</small></span>
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
                  <MoneyInput
                    valueCents={form.preco_promocional_centavos}
                    minCents={1}
                    maxCents={Math.max(1, form.preco_centavos - 1)}
                    onValueCentsChange={value => {
                      setFormDirty(true);
                      setForm(current => ({ ...current, preco_promocional_centavos: value }));
                    }}
                  />
                </label>
                <label>
                  Início
                  <DateTimeField value={form.promocao_inicio} onChange={value => {
                    setFormDirty(true);
                    setForm(current => ({ ...current, promocao_inicio: value }));
                  }} />
                </label>
                <label>
                  Fim
                  <DateTimeField value={form.promocao_fim} onChange={value => {
                    setFormDirty(true);
                    setForm(current => ({ ...current, promocao_fim: value }));
                  }} />
                </label>
              </div>
            </section>
          )}

          {error && <p className={styles.error} role="alert">{error}</p>}

          <footer>
            <button type="button" onClick={requestClose} disabled={operationBusy}>Cancelar</button>
            <button type="submit" disabled={operationBusy}>{saving ? "Salvando…" : imageBusy ? "Aguarde a imagem…" : "Salvar produto"}</button>
          </footer>
        </form>
      </section>
    </div>
  );
}
