import { useEffect, useMemo, useRef, useState } from "react";
import { listProducts } from "../products/product.api";
import type { Product } from "../products/product.types";
import { ApiClientError } from "../shared/apiClient";
import { useBackLayer } from "../shared/useBackLayer";
import { usePageScrollLock } from "../shared/usePageScrollLock";
import { updateOrderItem } from "./order.api";
import type { Order, OrderItem } from "./order.schema";
import { ManualOrderSelect } from "./ManualOrderSelect";
import styles from "./ManualOrderDialog.module.css";

type Props = {
  order: Order;
  item: OrderItem;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
};

function availableStock(product: Product): number {
  return Math.max(0, Number(product.estoque || 0) - Number(product.estoque_reservado || 0));
}

function currentUnitPrice(product: Product, now = Date.now()): number {
  const starts = product.promocao_inicio ? Date.parse(product.promocao_inicio) : null;
  const ends = product.promocao_fim ? Date.parse(product.promocao_fim) : null;
  const promotionActive =
    product.promocao_ativa &&
    Number(product.preco_promocional_centavos || 0) > 0 &&
    (!starts || starts <= now) &&
    (!ends || ends > now);

  return promotionActive
    ? Number(product.preco_promocional_centavos || product.preco_centavos)
    : Number(product.preco_centavos);
}

function money(cents: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}

export function EditOrderItemDialog({ order, item, onClose, onSaved }: Props) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [productId, setProductId] = useState(Number(item.produto_id || 0));
  const [quantity, setQuantity] = useState(Math.max(1, Number(item.quantidade || 1)));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savingRef = useRef(false);

  function updateSaving(value: boolean) {
    savingRef.current = value;
    setSaving(value);
  }

  const closeLayer = useBackLayer(
    true,
    () => {
      if (savingRef.current) return false;
      onClose();
      return true;
    },
    "edit-order-item"
  );

  usePageScrollLock(true);

  useEffect(() => {
    let alive = true;
    setLoadingProducts(true);
    void listProducts()
      .then(allProducts => {
        if (!alive) return;
        const selectable = allProducts.filter(product =>
          product.ativo && (product.id === Number(item.produto_id) || availableStock(product) > 0)
        );
        setProducts(selectable);
        setProductId(current => {
          if (selectable.some(product => product.id === current)) return current;
          const first = selectable[0];
          if (first) {
            setQuantity(1);
            return first.id;
          }
          return 0;
        });
      })
      .catch(err => {
        if (!alive) return;
        setError(err instanceof Error ? err.message : "Não foi possível carregar os produtos.");
      })
      .finally(() => {
        if (alive) setLoadingProducts(false);
      });

    return () => {
      alive = false;
    };
  }, [item.produto_id]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeLayer();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeLayer]);

  const productById = useMemo(
    () => new Map(products.map(product => [product.id, product])),
    [products]
  );
  const selectedProduct = productById.get(productId);
  const sameProduct = productId === Number(item.produto_id || 0);
  const maxQuantity = selectedProduct
    ? Math.min(50, availableStock(selectedProduct) + (sameProduct ? Number(item.quantidade || 0) : 0))
    : 50;
  const unitCents = sameProduct
    ? Number(item.valor_unitario_centavos || 0)
    : selectedProduct ? currentUnitPrice(selectedProduct) : 0;
  const previewTotal = unitCents * quantity;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingRef.current) return;
    setError(null);

    if (!item.id) {
      setError("Este item não possui um identificador válido para edição.");
      return;
    }
    if (!selectedProduct) {
      setError("Selecione um produto válido.");
      return;
    }
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 50) {
      setError("A quantidade deve ficar entre 1 e 50.");
      return;
    }
    if (quantity > maxQuantity) {
      setError(`${selectedProduct.nome}: estoque disponível insuficiente.`);
      return;
    }

    updateSaving(true);
    try {
      await updateOrderItem(order.id, {
        item_id: item.id,
        produto_id: selectedProduct.id,
        quantidade: quantity
      });
      await onSaved();
      updateSaving(false);
      closeLayer();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Não foi possível alterar o produto do pedido.");
    } finally {
      updateSaving(false);
    }
  }

  const productOptions = products.map(product => ({
    value: String(product.id),
    label: `${product.nome} · ${money(currentUnitPrice(product))} · ${availableStock(product)} disp.`
  }));

  return (
    <div className={styles.dialog}>
      <button
        className={styles.backdrop}
        type="button"
        aria-label="Fechar edição do item"
        disabled={saving}
        onClick={closeLayer}
      />
      <section className={styles.panel} role="dialog" aria-modal="true" aria-labelledby="edit-order-item-title">
        <header className={styles.head}>
          <div>
            <span>Pedido #{order.id}</span>
            <h2 id="edit-order-item-title">Trocar produto</h2>
            <p>{item.produto_nome || "Produto"} · {item.quantidade}x</p>
          </div>
          <button className={styles.close} type="button" onClick={closeLayer} disabled={saving} aria-label="Fechar">×</button>
        </header>

        <form className={styles.form} onSubmit={submit}>
          <section className={styles.itemSection}>
            <div className={styles.sectionHead}>
              <div>
                <h3>Item do pedido</h3>
                <small>Escolha o produto que deve ficar no lugar do atual.</small>
              </div>
            </div>

            {loadingProducts ? <p className={styles.itemMeta}>Carregando produtos...</p> : null}
            {!loadingProducts && !products.length ? <p className={styles.error}>Nenhum produto disponível</p> : null}

            <div className={styles.items}>
              <div className={styles.itemRow}>
                <div className={styles.field}>
                  <label htmlFor="edit-order-product">Produto</label>
                  <ManualOrderSelect
                    id="edit-order-product"
                    value={String(productId)}
                    options={productOptions}
                    disabled={saving || loadingProducts}
                    ariaLabel="Selecionar novo produto"
                    onChange={value => {
                      setProductId(Number(value));
                      setQuantity(1);
                    }}
                  />
                </div>
                <div className={styles.field}>
                  <label htmlFor="edit-order-qty">Qtd.</label>
                  <input
                    id="edit-order-qty"
                    type="number"
                    min={1}
                    max={Math.max(1, maxQuantity)}
                    step={1}
                    value={quantity}
                    disabled={saving}
                    onChange={event => setQuantity(Number(event.target.value))}
                  />
                </div>
              </div>
            </div>
          </section>

          <div className={styles.grid}>
            <div className={styles.field}>
              <label>Antes</label>
              <input value={`${item.quantidade}x ${item.produto_nome || "Produto"}`} readOnly disabled />
            </div>
            <div className={styles.field}>
              <label>Novo total do item</label>
              <input value={money(previewTotal)} readOnly disabled />
            </div>
          </div>

          <p className={styles.itemMeta}>
            Se o valor mudar, a comanda recalcula automaticamente o saldo ou crédito. Pagamentos já registrados são preservados.
          </p>

          {error ? <p className={styles.error} role="alert">{error}</p> : null}

          <footer className={styles.footer}>
            <button className={styles.cancel} type="button" onClick={closeLayer} disabled={saving}>Cancelar</button>
            <button className={styles.submit} type="submit" disabled={saving || loadingProducts || !selectedProduct}>
              {saving ? "Salvando..." : "Salvar troca"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
