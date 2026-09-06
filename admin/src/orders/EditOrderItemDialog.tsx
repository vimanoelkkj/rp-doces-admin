import { useEffect, useMemo, useRef, useState } from "react";
import { listProducts } from "../products/product.api";
import type { Product } from "../products/product.types";
import { ApiClientError } from "../shared/apiClient";
import { useBackLayer } from "../shared/useBackLayer";
import { usePageScrollLock } from "../shared/usePageScrollLock";
import { exchangePaidOrderItem, updateOrderItem, type RefundMethod } from "./order.api";
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

function defaultRefundMethod(value: string | null | undefined): RefundMethod {
  const method = String(value || "").toUpperCase();
  if (method.includes("DINHEIRO")) return "DINHEIRO";
  if (method.includes("CART")) return "CARTAO";
  if (method.includes("PIX")) return "PIX_EXTERNO";
  return "OUTRO";
}

const REFUND_METHOD_OPTIONS: Array<{ value: RefundMethod; label: string }> = [
  { value: "PIX_EXTERNO", label: "Pix" },
  { value: "DINHEIRO", label: "Dinheiro" },
  { value: "CARTAO", label: "Cartão" },
  { value: "OUTRO", label: "Outro meio" }
];

export function EditOrderItemDialog({ order, item, onClose, onSaved }: Props) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [productId, setProductId] = useState(Number(item.produto_id || 0));
  const [quantity, setQuantity] = useState(Math.max(1, Number(item.quantidade || 1)));
  const [refundMethod, setRefundMethod] = useState<RefundMethod>(() => defaultRefundMethod(order.metodo_pagamento));
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
  const paidCents = Number(item.valor_pago_centavos || 0);
  const paidExchange = paidCents > 0;
  const refundCents = paidExchange ? Math.max(0, paidCents - previewTotal) : 0;
  const pendingAfterExchange = paidExchange ? Math.max(0, previewTotal - paidCents) : 0;

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
      if (paidExchange) {
        await exchangePaidOrderItem(order.id, item.id, {
          produto_id: selectedProduct.id,
          quantidade: quantity,
          ...(refundCents > 0 ? {
            devolucao_metodo: refundMethod,
            confirmacao_devolucao: "DEVOLVIDO" as const
          } : {})
        });
      } else {
        await updateOrderItem(order.id, {
          item_id: item.id,
          produto_id: selectedProduct.id,
          quantidade: quantity
        });
      }
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

          {paidExchange ? (
            <section className={styles.itemSection}>
              <div className={styles.sectionHead}>
                <div>
                  <h3>Ajuste do pagamento</h3>
                  <small>O valor já pago acompanha o novo produto.</small>
                </div>
              </div>

              <div className={styles.grid}>
                <div className={styles.field}>
                  <label>Valor já pago</label>
                  <input value={money(paidCents)} readOnly disabled />
                </div>
                <div className={styles.field}>
                  <label>{refundCents > 0 ? "Diferença a devolver" : "Saldo após a troca"}</label>
                  <input
                    value={refundCents > 0 ? money(refundCents) : pendingAfterExchange > 0 ? `${money(pendingAfterExchange)} pendente` : "Quitado"}
                    readOnly
                    disabled
                  />
                </div>
              </div>

              {refundCents > 0 ? (
                <div className={styles.field}>
                  <label htmlFor="edit-order-refund-method">Forma da devolução</label>
                  <ManualOrderSelect
                    id="edit-order-refund-method"
                    value={refundMethod}
                    options={REFUND_METHOD_OPTIONS}
                    disabled={saving}
                    ariaLabel="Selecionar forma da devolução"
                    onChange={value => setRefundMethod(value as RefundMethod)}
                  />
                </div>
              ) : null}
            </section>
          ) : null}

          <p className={styles.itemMeta}>
            {refundCents > 0
              ? `Ao confirmar, ${money(refundCents)} será registrado como devolvido. O produto original volta ao estoque e o novo produto assume a baixa ou reserva correspondente.`
              : paidExchange
                ? "O pagamento já registrado será preservado no novo produto. Se o novo total for maior, somente a diferença ficará pendente."
                : "Se o valor mudar, a comanda recalcula automaticamente o saldo."
            }
          </p>

          {error ? <p className={styles.error} role="alert">{error}</p> : null}

          <footer className={styles.footer}>
            <button className={styles.cancel} type="button" onClick={closeLayer} disabled={saving}>Cancelar</button>
            <button className={styles.submit} type="submit" disabled={saving || loadingProducts || !selectedProduct}>
              {saving ? "Salvando..." : refundCents > 0 ? `Trocar e devolver ${money(refundCents)}` : "Salvar troca"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
