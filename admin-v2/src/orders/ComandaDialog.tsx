import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiClientError } from "../shared/apiClient";
import { listProducts } from "../products/product.api";
import type { Product } from "../products/product.types";
import {
  addComandaItem,
  cancelComandaPix,
  generateComandaPix,
  listFinancialOrders,
  registerComandaPayment,
  type FinancialOrder,
  type ManualComandaPaymentMethod,
  type OrderPayment,
  type PixDecision
} from "./order.finance";
import styles from "./ComandaDialog.module.css";

type Props = {
  orderId: number;
  onClose: () => void;
  onChanged: () => void;
};

type AddPaymentMode = "PENDENTE" | "PAGO" | "PIX";

const PAYMENT_LABELS: Record<string, string> = {
  PIX_MP: "Pix pelo site",
  PIX: "Pix pelo site",
  PIX_EXTERNO: "Pix direto",
  CARTAO: "Cartão",
  DINHEIRO: "Dinheiro",
  A_COMBINAR: "A combinar"
};

function money(cents?: number | null): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    Number(cents || 0) / 100
  );
}

function dateTime(value?: string | null): string {
  if (!value) return "—";
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(" ", "T")}Z`
    : value;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(date);
}

function centsFromInput(value: string): number {
  const number = Number(String(value || "").replace(",", "."));
  return Number.isFinite(number) ? Math.round(number * 100) : 0;
}

function financialLabel(value: string): string {
  if (value === "PAGO") return "Pago";
  if (value === "PARCIAL") return "Parcial";
  return "Pendente";
}

function statusClass(value: string): string {
  if (value === "PAGO") return styles.statusPaid;
  if (value === "PARCIAL") return styles.statusPartial;
  if (["CANCELADO", "EXPIRADO", "FALHOU", "REEMBOLSADO"].includes(value)) return styles.statusCancelled;
  return styles.statusPending;
}

export function ComandaDialog({ orderId, onClose, onChanged }: Props) {
  const [order, setOrder] = useState<FinancialOrder | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [latestPix, setLatestPix] = useState<OrderPayment | null>(null);

  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [addPaymentMode, setAddPaymentMode] = useState<AddPaymentMode>("PENDENTE");
  const [addMethod, setAddMethod] = useState<ManualComandaPaymentMethod>("CARTAO");
  const [addPixDecision, setAddPixDecision] = useState<PixDecision>("MANTER");

  const [paymentMethod, setPaymentMethod] = useState<ManualComandaPaymentMethod>("CARTAO");
  const [paymentValue, setPaymentValue] = useState("");
  const [paymentPixDecision, setPaymentPixDecision] = useState<PixDecision>("CANCELAR");
  const [pixValue, setPixValue] = useState("");
  const [pixDecision, setPixDecision] = useState<PixDecision>("CANCELAR");

  const load = useCallback(async () => {
    const [orders, catalog] = await Promise.all([listFinancialOrders(), listProducts()]);
    const found = orders.find(candidate => candidate.id === orderId) || null;
    if (!found) throw new Error("Comanda não encontrada.");
    setOrder(found);
    setProducts(catalog.filter(product => Boolean(product.ativo) && Boolean(product.disponivel)));
    setPaymentValue((found.saldo_centavos / 100).toFixed(2));
    setPixValue((found.saldo_centavos / 100).toFixed(2));
  }, [orderId]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    void load()
      .catch(err => setError(err instanceof Error ? err.message : "Não foi possível carregar a comanda."))
      .finally(() => setLoading(false));
  }, [load]);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", keydown);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", keydown);
    };
  }, [onClose, saving]);

  const pendingPix = useMemo(
    () => order?.pagamentos.find(payment => payment.metodo === "PIX_MP" && payment.status === "PENDENTE") || null,
    [order]
  );

  const selectedProduct = useMemo(
    () => products.find(product => String(product.id) === productId) || null,
    [products, productId]
  );

  const run = useCallback(async (task: () => Promise<void>) => {
    setSaving(true);
    setError(null);
    setFeedback(null);
    try {
      await task();
      await load();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiClientError || err instanceof Error ? err.message : "Não foi possível concluir a operação.");
    } finally {
      setSaving(false);
    }
  }, [load, onChanged]);

  const handleAddItem = () => run(async () => {
    const produto = Number(productId);
    const qty = Number(quantity);
    if (!Number.isInteger(produto) || !Number.isInteger(qty) || qty < 1) {
      throw new Error("Selecione o produto e uma quantidade válida.");
    }

    const added = await addComandaItem(orderId, { produto_id: produto, quantidade: qty });
    const subtotal = Number(added.item?.valor_total_centavos || 0);

    if (addPaymentMode === "PAGO" && subtotal > 0) {
      await registerComandaPayment(orderId, {
        metodo: addMethod,
        valor_centavos: subtotal,
        ...(pendingPix ? { pix_pendente: addPixDecision } : {})
      });
      setFeedback("Item adicionado e pagamento registrado.");
    } else if (addPaymentMode === "PIX" && subtotal > 0) {
      const pix = await generateComandaPix(orderId, {
        ...(pendingPix && addPixDecision === "CANCELAR" ? {} : { valor_centavos: subtotal }),
        ...(pendingPix ? { pix_pendente: addPixDecision } : {})
      });
      setLatestPix(pix.pagamento || null);
      setFeedback(
        pendingPix && addPixDecision === "CANCELAR"
          ? "Item adicionado e o Pix anterior foi substituído pelo saldo atualizado."
          : "Item adicionado e nova cobrança Pix gerada."
      );
    } else {
      setFeedback("Item adicionado à comanda e deixado pendente.");
    }

    setQuantity("1");
  });

  const handleRegisterPayment = () => run(async () => {
    const cents = centsFromInput(paymentValue);
    if (cents <= 0) throw new Error("Informe um valor de pagamento válido.");
    await registerComandaPayment(orderId, {
      metodo: paymentMethod,
      valor_centavos: cents,
      ...(pendingPix ? { pix_pendente: paymentPixDecision } : {})
    });
    setFeedback("Pagamento registrado no histórico da comanda.");
  });

  const handleGeneratePix = () => run(async () => {
    const cents = centsFromInput(pixValue);
    if (cents <= 0) throw new Error("Informe um valor de cobrança válido.");
    const result = await generateComandaPix(orderId, {
      valor_centavos: cents,
      ...(pendingPix ? { pix_pendente: pixDecision } : {})
    });
    setLatestPix(result.pagamento || null);
    setFeedback("Cobrança Pix gerada.");
  });

  const handleCancelPix = () => run(async () => {
    await cancelComandaPix(orderId);
    setLatestPix(null);
    setFeedback("Cobrança Pix pendente cancelada.");
  });

  const copyPix = async () => {
    const code = latestPix?.mp_qr_code || pendingPix?.mp_qr_code;
    if (!code) return;
    await navigator.clipboard.writeText(code);
    setFeedback("Código Pix copiado.");
  };

  const open = order?.status_comanda !== "ENCERRADA";

  return (
    <div className={styles.dialog}>
      <button className={styles.backdrop} type="button" onClick={saving ? undefined : onClose} aria-label="Fechar comanda" />
      <section className={styles.panel} role="dialog" aria-modal="true" aria-labelledby="comanda-title">
        <header className={styles.head}>
          <div>
            <span>Pedido #{orderId} · Comanda</span>
            <h2 id="comanda-title">{order?.cliente_nome || "Cliente"}</h2>
            <span>{order ? `Aberta desde ${dateTime(order.criado_em)}` : "Carregando…"}</span>
          </div>
          <button className={styles.close} type="button" onClick={onClose} disabled={saving} aria-label="Fechar">×</button>
        </header>

        {order ? (
          <div className={styles.statusRow}>
            <span className={`${styles.pill} ${open ? styles.open : styles.closed}`}>{open ? "Comanda aberta" : "Comanda encerrada"}</span>
            <span className={`${styles.pill} ${order.status_financeiro === "PAGO" ? styles.paid : styles.pending}`}>
              Financeiro: {financialLabel(order.status_financeiro)}
            </span>
            {pendingPix ? <span className={`${styles.pill} ${styles.pending}`}>Pix atual pendente · {money(pendingPix.valor_centavos)}</span> : null}
          </div>
        ) : null}

        <div className={styles.body}>
          {loading ? <div className={styles.empty}>Carregando a comanda…</div> : null}
          {error ? <p className={styles.error} role="alert">{error}</p> : null}
          {feedback ? <p className={styles.feedback}>{feedback}</p> : null}

          {order ? (
            <>
              <section className={styles.section}>
                <header className={styles.sectionTitle}>
                  <div><strong>Itens</strong><span>Consumo e situação financeira por item</span></div>
                </header>
                {order.itens.map(item => (
                  <div className={styles.item} key={item.id}>
                    <div>
                      <strong>{item.quantidade}× {item.produto_nome || "Produto"}</strong>
                      <span>{money(item.valor_unitario_centavos)} cada · pago {money(item.valor_pago_centavos)}</span>
                    </div>
                    <div className={styles.itemAmount}>
                      {money(item.valor_total_centavos)}
                      <small className={statusClass(item.status_financeiro)}>{financialLabel(item.status_financeiro)}</small>
                    </div>
                  </div>
                ))}
              </section>

              <div className={styles.summary}>
                <article><span>Total</span><strong>{money(order.valor_total_centavos)}</strong></article>
                <article><span>Pago</span><strong>{money(order.valor_pago_centavos)}</strong></article>
                <article><span>Restante</span><strong>{money(order.saldo_centavos)}</strong></article>
              </div>

              {open ? (
                <div className={styles.actionsGrid}>
                  <section className={styles.actionCard}>
                    <h3>Adicionar ao pedido</h3>
                    <p>Inclui um novo consumo sem alterar pagamentos anteriores.</p>
                    <div className={styles.form}>
                      <div className={styles.inlineFields}>
                        <div className={styles.field}>
                          <label htmlFor={`comanda-product-${orderId}`}>Produto</label>
                          <select id={`comanda-product-${orderId}`} value={productId} onChange={event => setProductId(event.target.value)} disabled={saving}>
                            <option value="">Selecione</option>
                            {products.map(product => <option key={product.id} value={product.id}>{product.nome}</option>)}
                          </select>
                        </div>
                        <div className={styles.field}>
                          <label htmlFor={`comanda-qty-${orderId}`}>Quantidade</label>
                          <input id={`comanda-qty-${orderId}`} type="number" min="1" max="50" value={quantity} onChange={event => setQuantity(event.target.value)} disabled={saving} />
                        </div>
                      </div>
                      {selectedProduct ? <span className={styles.meta}>Preço atual do catálogo: {money(selectedProduct.preco_centavos)}</span> : null}
                      <div className={styles.field}>
                        <label htmlFor={`comanda-add-payment-${orderId}`}>Pagamento deste acréscimo</label>
                        <select id={`comanda-add-payment-${orderId}`} value={addPaymentMode} onChange={event => setAddPaymentMode(event.target.value as AddPaymentMode)} disabled={saving}>
                          <option value="PENDENTE">Deixar pendente</option>
                          <option value="PAGO">Registrar como pago agora</option>
                          <option value="PIX">Gerar Pix</option>
                        </select>
                      </div>
                      {addPaymentMode === "PAGO" ? (
                        <div className={styles.field}>
                          <label>Forma</label>
                          <select value={addMethod} onChange={event => setAddMethod(event.target.value as ManualComandaPaymentMethod)} disabled={saving}>
                            <option value="CARTAO">Cartão</option>
                            <option value="DINHEIRO">Dinheiro</option>
                            <option value="PIX_EXTERNO">Pix direto</option>
                          </select>
                        </div>
                      ) : null}
                      {pendingPix && addPaymentMode !== "PENDENTE" ? (
                        <div className={styles.choiceGroup}>
                          <strong>Existe um Pix pendente de {money(pendingPix.valor_centavos)}. O que fazer?</strong>
                          <label className={styles.choice}><input type="radio" checked={addPixDecision === "CANCELAR"} onChange={() => setAddPixDecision("CANCELAR")} /> <span>Cancelar o Pix atual{addPaymentMode === "PIX" ? " e cobrar o saldo atualizado" : ""}</span></label>
                          <label className={styles.choice}><input type="radio" checked={addPixDecision === "MANTER"} onChange={() => setAddPixDecision("MANTER")} /> <span>Manter o Pix atual e tratar somente o novo valor</span></label>
                        </div>
                      ) : null}
                      <button className={styles.primary} type="button" onClick={() => void handleAddItem()} disabled={saving || !productId}>
                        {saving ? "Salvando…" : "+ Adicionar ao pedido"}
                      </button>
                    </div>
                  </section>

                  <section className={styles.actionCard}>
                    <h3>Registrar pagamento</h3>
                    <p>Receba parte ou todo o saldo por outro meio.</p>
                    <div className={styles.form}>
                      <div className={styles.inlineFields}>
                        <div className={styles.field}>
                          <label>Forma</label>
                          <select value={paymentMethod} onChange={event => setPaymentMethod(event.target.value as ManualComandaPaymentMethod)} disabled={saving}>
                            <option value="CARTAO">Cartão</option>
                            <option value="DINHEIRO">Dinheiro</option>
                            <option value="PIX_EXTERNO">Pix direto</option>
                          </select>
                        </div>
                        <div className={styles.field}>
                          <label>Valor</label>
                          <input inputMode="decimal" value={paymentValue} onChange={event => setPaymentValue(event.target.value)} disabled={saving} />
                        </div>
                      </div>
                      {pendingPix ? (
                        <div className={styles.choiceGroup}>
                          <strong>E o Pix pendente de {money(pendingPix.valor_centavos)}?</strong>
                          <label className={styles.choice}><input type="radio" checked={paymentPixDecision === "CANCELAR"} onChange={() => setPaymentPixDecision("CANCELAR")} /> <span>Cancelar e considerar este novo pagamento</span></label>
                          <label className={styles.choice}><input type="radio" checked={paymentPixDecision === "MANTER"} onChange={() => setPaymentPixDecision("MANTER")} /> <span>Manter e receber somente outra parte</span></label>
                        </div>
                      ) : null}
                      <button className={styles.primary} type="button" onClick={() => void handleRegisterPayment()} disabled={saving || order.saldo_centavos <= 0}>
                        {saving ? "Registrando…" : "Registrar pagamento"}
                      </button>
                    </div>
                  </section>

                  <section className={styles.actionCard}>
                    <h3>Gerar Pix</h3>
                    <p>Cria uma cobrança nova sem apagar cobranças anteriores.</p>
                    <div className={styles.form}>
                      <div className={styles.field}>
                        <label>Valor da cobrança</label>
                        <input inputMode="decimal" value={pixValue} onChange={event => setPixValue(event.target.value)} disabled={saving} />
                      </div>
                      {pendingPix ? (
                        <div className={styles.choiceGroup}>
                          <strong>Pix atual: {money(pendingPix.valor_centavos)} pendentes</strong>
                          <label className={styles.choice}><input type="radio" checked={pixDecision === "CANCELAR"} onChange={() => setPixDecision("CANCELAR")} /> <span>Cancelar o Pix atual e gerar outro</span></label>
                          <label className={styles.choice}><input type="radio" checked={pixDecision === "MANTER"} onChange={() => setPixDecision("MANTER")} /> <span>Manter e gerar outra cobrança</span></label>
                        </div>
                      ) : null}
                      <button className={styles.primary} type="button" onClick={() => void handleGeneratePix()} disabled={saving || order.saldo_centavos <= 0}>
                        {saving ? "Gerando…" : "Gerar Pix"}
                      </button>
                      {pendingPix ? <button className={styles.danger} type="button" onClick={() => void handleCancelPix()} disabled={saving}>Cancelar Pix pendente</button> : null}
                    </div>
                  </section>
                </div>
              ) : null}

              {(latestPix?.mp_qr_code || pendingPix?.mp_qr_code) ? (
                <div className={styles.pixBox}>
                  <strong>Pix copia e cola</strong>
                  <div className={styles.pixCode}>{latestPix?.mp_qr_code || pendingPix?.mp_qr_code}</div>
                  <button className={styles.secondary} type="button" onClick={() => void copyPix()}>Copiar código</button>
                </div>
              ) : null}

              <section className={styles.section}>
                <header className={styles.sectionTitle}>
                  <div><strong>Pagamentos e cobranças</strong><span>Histórico preservado da comanda</span></div>
                </header>
                {order.pagamentos.length ? order.pagamentos.map((payment, index) => (
                  <div className={styles.payment} key={payment.id ?? `legacy-${index}`}>
                    <div>
                      <strong>{PAYMENT_LABELS[payment.metodo] || payment.metodo}</strong>
                      <span>{payment.origem === "ADMIN" ? "Registrado pelo admin" : "Criado pelo site"} · {dateTime(payment.pago_em || payment.criado_em)}</span>
                      {payment.substitui_pagamento_id ? <span>Substitui a cobrança #{payment.substitui_pagamento_id}</span> : null}
                    </div>
                    <div className={styles.paymentAmount}>
                      {money(payment.valor_centavos)}
                      <small className={statusClass(payment.status)}>{payment.status}</small>
                    </div>
                  </div>
                )) : <div className={styles.empty}>Nenhum pagamento registrado.</div>}
              </section>
            </>
          ) : null}
        </div>
      </section>
    </div>
  );
}
