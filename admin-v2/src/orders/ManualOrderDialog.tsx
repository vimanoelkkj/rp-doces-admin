import { useEffect, useMemo, useState } from "react";
import { listProducts } from "../products/product.api";
import type { Product } from "../products/product.types";
import { ApiClientError } from "../shared/apiClient";
import {
  createManualOrder,
  type ManualOrderPaymentMethod,
  type ManualOrderPaymentStatus
} from "./order.api";
import styles from "./ManualOrderDialog.module.css";

type Props = {
  onClose: () => void;
  onCreated: (id: number) => void | Promise<void>;
};

type ItemDraft = {
  key: number;
  produtoId: number;
  quantidade: number;
};

const PAYMENT_METHODS: Array<[ManualOrderPaymentMethod, string]> = [
  ["PIX_EXTERNO", "Pix direto"],
  ["CARTAO", "Cartão"],
  ["DINHEIRO", "Dinheiro"],
  ["A_COMBINAR", "A combinar"]
];

const PAYMENT_STATUSES: Array<[ManualOrderPaymentStatus, string]> = [
  ["PENDENTE", "Aguardando pagamento"],
  ["PAGO", "Pagamento confirmado"]
];

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

export function ManualOrderDialog({ onClose, onCreated }: Props) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [items, setItems] = useState<ItemDraft[]>([]);
  const [nextKey, setNextKey] = useState(1);
  const [clienteNome, setClienteNome] = useState("");
  const [clienteWhatsapp, setClienteWhatsapp] = useState("");
  const [observacao, setObservacao] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<ManualOrderPaymentMethod>("PIX_EXTERNO");
  const [paymentStatus, setPaymentStatus] = useState<ManualOrderPaymentStatus>("PENDENTE");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoadingProducts(true);
    void listProducts()
      .then(allProducts => {
        if (!alive) return;
        const available = allProducts.filter(
          product => product.ativo && product.disponivel && availableStock(product) > 0
        );
        setProducts(available);
        if (available.length) {
          setItems([{ key: 0, produtoId: available[0].id, quantidade: 1 }]);
        }
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
  }, []);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, saving]);

  const productById = useMemo(
    () => new Map(products.map(product => [product.id, product])),
    [products]
  );

  const total = useMemo(
    () => items.reduce((sum, item) => {
      const product = productById.get(item.produtoId);
      return sum + (product ? currentUnitPrice(product) * item.quantidade : 0);
    }, 0),
    [items, productById]
  );

  function updateItem(key: number, patch: Partial<Omit<ItemDraft, "key">>) {
    setItems(current => current.map(item => item.key === key ? { ...item, ...patch } : item));
  }

  function addItem() {
    if (items.length >= 20) return;
    const selected = new Set(items.map(item => item.produtoId));
    const nextProduct = products.find(product => !selected.has(product.id));
    if (!nextProduct) return;
    setItems(current => [...current, { key: nextKey, produtoId: nextProduct.id, quantidade: 1 }]);
    setNextKey(value => value + 1);
  }

  function removeItem(key: number) {
    setItems(current => current.filter(item => item.key !== key));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setError(null);

    if (!items.length) {
      setError("Adicione pelo menos um produto ao pedido.");
      return;
    }

    for (const item of items) {
      const product = productById.get(item.produtoId);
      if (!product) {
        setError("Selecione um produto válido em todos os itens.");
        return;
      }
      if (!Number.isInteger(item.quantidade) || item.quantidade < 1 || item.quantidade > 50) {
        setError("A quantidade de cada produto deve ficar entre 1 e 50.");
        return;
      }
      if (item.quantidade > availableStock(product)) {
        setError(`${product.nome}: estoque disponível insuficiente.`);
        return;
      }
    }

    setSaving(true);
    try {
      const id = await createManualOrder({
        itens: items.map(item => ({ produto_id: item.produtoId, quantidade: item.quantidade })),
        cliente_nome: clienteNome.trim(),
        cliente_whatsapp: clienteWhatsapp.trim(),
        observacao: observacao.trim(),
        metodo_pagamento: paymentMethod,
        status_pagamento: paymentStatus
      });
      await onCreated(id);
    } catch (err) {
      setError(
        err instanceof ApiClientError ? err.message : "Não foi possível registrar o pedido manual."
      );
    } finally {
      setSaving(false);
    }
  }

  const canAddItem = items.length < Math.min(20, products.length);

  return (
    <div className={styles.dialog}>
      <button
        className={styles.backdrop}
        type="button"
        aria-label="Fechar novo pedido"
        disabled={saving}
        onClick={saving ? undefined : onClose}
      />
      <section className={styles.panel} role="dialog" aria-modal="true" aria-labelledby="manual-order-title">
        <header className={styles.head}>
          <div>
            <span>Pedido manual</span>
            <h2 id="manual-order-title">Novo pedido</h2>
            <p>Registre uma venda feita fora do site.</p>
          </div>
          <button className={styles.close} type="button" onClick={onClose} disabled={saving} aria-label="Fechar">×</button>
        </header>

        <form className={styles.form} onSubmit={submit}>
          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <div>
                <h3>Itens</h3>
                <small>O preço final e o estoque são validados novamente pelo servidor.</small>
              </div>
              <button className={styles.add} type="button" onClick={addItem} disabled={saving || loadingProducts || !canAddItem}>
                Adicionar item
              </button>
            </div>

            {loadingProducts ? <p className={styles.itemMeta}>Carregando produtos...</p> : null}
            {!loadingProducts && !products.length ? (
              <p className={styles.error}>Não há produtos ativos e disponíveis com estoque para registrar um pedido.</p>
            ) : null}

            <div className={styles.items}>
              {items.map(item => {
                const product = productById.get(item.produtoId);
                const selectedElsewhere = new Set(items.filter(other => other.key !== item.key).map(other => other.produtoId));
                return (
                  <div className={styles.itemRow} key={item.key}>
                    <div className={styles.field}>
                      <label htmlFor={`manual-product-${item.key}`}>Produto</label>
                      <select
                        id={`manual-product-${item.key}`}
                        value={item.produtoId}
                        disabled={saving}
                        onChange={event => updateItem(item.key, { produtoId: Number(event.target.value), quantidade: 1 })}
                      >
                        {products.map(option => (
                          <option key={option.id} value={option.id} disabled={selectedElsewhere.has(option.id)}>
                            {option.nome} - {money(currentUnitPrice(option))}
                          </option>
                        ))}
                      </select>
                      {product ? (
                        <span className={styles.itemMeta}>{availableStock(product)} disponível(is)</span>
                      ) : null}
                    </div>
                    <div className={styles.field}>
                      <label htmlFor={`manual-qty-${item.key}`}>Qtd.</label>
                      <input
                        id={`manual-qty-${item.key}`}
                        type="number"
                        min={1}
                        max={Math.min(50, product ? availableStock(product) : 50)}
                        step={1}
                        value={item.quantidade}
                        disabled={saving}
                        onChange={event => updateItem(item.key, { quantidade: Number(event.target.value) })}
                      />
                    </div>
                    <button
                      className={styles.remove}
                      type="button"
                      onClick={() => removeItem(item.key)}
                      disabled={saving || items.length === 1}
                      aria-label="Remover item"
                      title="Remover item"
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>

            <div className={styles.total}>
              <span>Total estimado</span>
              <strong>{money(total)}</strong>
            </div>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHead}><h3>Cliente</h3><small>Campos opcionais</small></div>
            <div className={styles.grid}>
              <div className={styles.field}>
                <label htmlFor="manual-client-name">Nome</label>
                <input id="manual-client-name" value={clienteNome} maxLength={120} disabled={saving} onChange={event => setClienteNome(event.target.value)} />
              </div>
              <div className={styles.field}>
                <label htmlFor="manual-client-whatsapp">WhatsApp</label>
                <input id="manual-client-whatsapp" value={clienteWhatsapp} maxLength={40} disabled={saving} onChange={event => setClienteWhatsapp(event.target.value)} />
              </div>
            </div>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHead}><h3>Pagamento</h3></div>
            <div className={styles.grid}>
              <div className={styles.field}>
                <label htmlFor="manual-payment-method">Forma de pagamento</label>
                <select id="manual-payment-method" value={paymentMethod} disabled={saving} onChange={event => setPaymentMethod(event.target.value as ManualOrderPaymentMethod)}>
                  {PAYMENT_METHODS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </div>
              <div className={styles.field}>
                <label htmlFor="manual-payment-status">Situação</label>
                <select id="manual-payment-status" value={paymentStatus} disabled={saving} onChange={event => setPaymentStatus(event.target.value as ManualOrderPaymentStatus)}>
                  {PAYMENT_STATUSES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </div>
              <div className={`${styles.field} ${styles.fieldFull}`}>
                <label htmlFor="manual-note">Observação</label>
                <textarea id="manual-note" value={observacao} maxLength={500} disabled={saving} onChange={event => setObservacao(event.target.value)} />
              </div>
            </div>
          </section>

          {error ? <p className={styles.error} role="alert">{error}</p> : null}

          <footer className={styles.footer}>
            <button className={styles.cancel} type="button" onClick={onClose} disabled={saving}>Cancelar</button>
            <button className={styles.submit} type="submit" disabled={saving || loadingProducts || !products.length}>
              {saving ? "Registrando..." : "Registrar pedido"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
