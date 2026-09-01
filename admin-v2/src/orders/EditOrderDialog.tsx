import { useEffect, useMemo, useState } from "react";
import { listProducts } from "../products/product.api";
import type { Product } from "../products/product.types";
import { ApiClientError } from "../shared/apiClient";
import { editOrder, type ManualOrderPaymentMethod } from "./order.api";
import type { Order } from "./order.schema";
import { ManualOrderSelect } from "./ManualOrderSelect";
import styles from "./ManualOrderDialog.module.css";

type Props = {
  order: Order;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
};

type ItemDraft = { key: number; produtoId: number; quantidade: number };

const PAYMENT_METHODS: Array<[ManualOrderPaymentMethod, string]> = [
  ["PIX_EXTERNO", "Pix direto"],
  ["CARTAO", "Cartão"],
  ["DINHEIRO", "Dinheiro"],
  ["A_COMBINAR", "A combinar"]
];

function availableStock(product: Product): number {
  return Math.max(0, Number(product.estoque || 0) - Number(product.estoque_reservado || 0));
}

function currentReservedByProduct(order: Order): Map<number, number> {
  const map = new Map<number, number>();
  if (String(order.reserva_status || "").toUpperCase() !== "ATIVA") return map;
  for (const item of order.itens || []) {
    const id = Number(item.produto_id || 0);
    if (!id) continue;
    map.set(id, (map.get(id) || 0) + Number(item.quantidade || 0));
  }
  return map;
}

function money(cents: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}

function currentUnitPrice(product: Product, now = Date.now()): number {
  const starts = product.promocao_inicio ? Date.parse(product.promocao_inicio) : null;
  const ends = product.promocao_fim ? Date.parse(product.promocao_fim) : null;
  const active = product.promocao_ativa && Number(product.preco_promocional_centavos || 0) > 0 && (!starts || starts <= now) && (!ends || ends > now);
  return active ? Number(product.preco_promocional_centavos || product.preco_centavos) : Number(product.preco_centavos);
}

function initialPaymentMethod(order: Order): ManualOrderPaymentMethod {
  const method = String(order.metodo_pagamento || "").toUpperCase();
  return PAYMENT_METHODS.some(([value]) => value === method) ? method as ManualOrderPaymentMethod : "A_COMBINAR";
}

export function EditOrderDialog({ order, onClose, onSaved }: Props) {
  const initialItems = (order.itens || [])
    .filter(item => Number(item.produto_id || 0) > 0)
    .map((item, index) => ({ key: index, produtoId: Number(item.produto_id), quantidade: Number(item.quantidade || 1) }));
  const [products, setProducts] = useState<Product[]>([]);
  const [items, setItems] = useState<ItemDraft[]>(initialItems);
  const [nextKey, setNextKey] = useState(Math.max(1, initialItems.length));
  const [paymentMethod, setPaymentMethod] = useState<ManualOrderPaymentMethod>(initialPaymentMethod(order));
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentReserved = useMemo(() => currentReservedByProduct(order), [order]);

  useEffect(() => {
    let alive = true;
    void listProducts()
      .then(all => {
        if (!alive) return;
        setProducts(all.filter(product => product.ativo));
      })
      .catch(err => {
        if (alive) setError(err instanceof Error ? err.message : "Não foi possível carregar os produtos.");
      })
      .finally(() => {
        if (alive) setLoadingProducts(false);
      });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose, saving]);

  const productById = useMemo(() => new Map(products.map(product => [product.id, product])), [products]);
  const effectiveAvailable = (product: Product) => availableStock(product) + (currentReserved.get(product.id) || 0);

  function updateItem(key: number, patch: Partial<Omit<ItemDraft, "key">>) {
    setItems(current => current.map(item => item.key === key ? { ...item, ...patch } : item));
  }

  function addItem() {
    if (items.length >= 20) return;
    const selected = new Set(items.map(item => item.produtoId));
    const next = products.find(product => product.disponivel && effectiveAvailable(product) > 0 && !selected.has(product.id));
    if (!next) return;
    setItems(current => [...current, { key: nextKey, produtoId: next.id, quantidade: 1 }]);
    setNextKey(value => value + 1);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setError(null);
    if (!items.length) return setError("O pedido precisa ter pelo menos um item.");

    for (const item of items) {
      const product = productById.get(item.produtoId);
      if (!product) return setError("Selecione um produto válido em todos os itens.");
      if (!Number.isInteger(item.quantidade) || item.quantidade < 1 || item.quantidade > 50) return setError("A quantidade de cada item deve ficar entre 1 e 50.");
      if (item.quantidade > effectiveAvailable(product)) return setError(`${product.nome}: estoque disponível insuficiente.`);
    }

    setSaving(true);
    try {
      await editOrder(order.id, {
        itens: items.map(item => ({ produto_id: item.produtoId, quantidade: item.quantidade })),
        metodo_pagamento: paymentMethod
      });
      await onSaved();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Não foi possível editar o pedido.");
    } finally {
      setSaving(false);
    }
  }

  const canAddItem = items.length < Math.min(20, products.length);

  return (
    <div className={styles.dialog}>
      <button className={styles.backdrop} type="button" aria-label="Fechar edição" disabled={saving} onClick={saving ? undefined : onClose} />
      <section className={styles.panel} role="dialog" aria-modal="true" aria-labelledby="edit-order-title">
        <header className={styles.head}>
          <div>
            <span>Pedido #{order.id}</span>
            <h2 id="edit-order-title">Editar pedido</h2>
            <p>Altere itens, quantidades e a forma de pagamento sem criar outro pedido.</p>
          </div>
          <button className={styles.close} type="button" onClick={onClose} disabled={saving} aria-label="Fechar">×</button>
        </header>

        <form className={styles.form} onSubmit={submit}>
          <section className={styles.itemSection}>
            <div className={styles.sectionHead}>
              <div><h3>Itens</h3><small>O total e a nova reserva serão recalculados ao salvar.</small></div>
              <button className={styles.add} type="button" onClick={addItem} disabled={saving || loadingProducts || !canAddItem}>+ Adicionar item</button>
            </div>
            <div className={styles.items}>
              {items.map(item => {
                const product = productById.get(item.produtoId);
                const selectedElsewhere = new Set(items.filter(other => other.key !== item.key).map(other => other.produtoId));
                const options = products.map(option => ({
                  value: String(option.id),
                  label: `${option.nome} · ${money(currentUnitPrice(option))} · ${effectiveAvailable(option)} disp.`,
                  disabled: selectedElsewhere.has(option.id) || effectiveAvailable(option) <= 0
                }));
                return (
                  <div className={styles.itemRow} key={item.key}>
                    <div className={styles.field}>
                      <label htmlFor={`edit-product-${item.key}`}>Produto</label>
                      <ManualOrderSelect id={`edit-product-${item.key}`} value={String(item.produtoId)} options={options} disabled={saving} ariaLabel="Selecionar produto" onChange={value => updateItem(item.key, { produtoId: Number(value), quantidade: 1 })} />
                    </div>
                    <div className={styles.field}>
                      <label htmlFor={`edit-qty-${item.key}`}>Qtd.</label>
                      <input id={`edit-qty-${item.key}`} type="number" min={1} max={Math.min(50, product ? effectiveAvailable(product) : 50)} value={item.quantidade} disabled={saving} onChange={event => updateItem(item.key, { quantidade: Number(event.target.value) })} />
                    </div>
                    <button className={styles.remove} type="button" disabled={saving || items.length === 1} onClick={() => setItems(current => current.filter(currentItem => currentItem.key !== item.key))} aria-label="Remover item">×</button>
                  </div>
                );
              })}
            </div>
          </section>

          <div className={styles.field}>
            <label htmlFor="edit-payment-method">Forma de pagamento</label>
            <ManualOrderSelect id="edit-payment-method" value={paymentMethod} options={PAYMENT_METHODS.map(([value, label]) => ({ value, label }))} disabled={saving} ariaLabel="Forma de pagamento" onChange={setPaymentMethod} />
            {order.mp_order_id ? <small>Ao salvar, o Pix atual do site será cancelado antes da alteração.</small> : null}
          </div>

          {error ? <p className={styles.error} role="alert">{error}</p> : null}

          <footer className={styles.actions}>
            <button className={styles.cancel} type="button" disabled={saving} onClick={onClose}>Cancelar</button>
            <button className={styles.submit} type="submit" disabled={saving || loadingProducts}>{saving ? "Salvando…" : "Salvar alterações"}</button>
          </footer>
        </form>
      </section>
    </div>
  );
}
