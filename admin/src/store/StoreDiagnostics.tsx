import { useEffect, useMemo, useState } from "react";
import type { AuthSession } from "../auth/AuthGate";
import type { AdminV2Page } from "../layout/AdminShell";
import { listProducts } from "../products/product.api";
import type { Product } from "../products/product.types";
import { AdminSelect } from "../shared/AdminSelect";
import {
  StoreDiagnosticsConfirmDialog,
  type DiagnosticConfirmKind
} from "./StoreDiagnosticsConfirmDialog";
import styles from "./StoreDiagnostics.module.css";

type Props = {
  session: AuthSession;
  onNavigate: (page: AdminV2Page) => void;
};

type PixDiagnostic = {
  diagnostico?: boolean;
  order_id?: string | null;
  status?: string | null;
  qr_code?: string | null;
  qr_code_base64?: string | null;
  ticket_url?: string | null;
  valor_centavos?: number;
  reembolsado?: boolean;
};

type OrderTestResult = { ok: true; id: number };
type OrderListResponse = {
  pedidos?: Array<{
    id: number;
    pedido_teste?: boolean | number;
    arquivado?: boolean | number;
    status_pedido?: string | null;
  }>;
};

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: "include",
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof payload?.erro === "string" ? payload.erro : `Erro ${response.status}.`);
  }
  return payload as T;
}

function money(cents = 0) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}

export function StoreDiagnostics({ session, onNavigate }: Props) {
  const owner = String(session.user.papel || "").toUpperCase() === "OWNER";
  const [pix, setPix] = useState<PixDiagnostic | null>(null);
  const [pixBusy, setPixBusy] = useState(false);
  const [pixStatus, setPixStatus] = useState("Aguardando teste");
  const [products, setProducts] = useState<Product[]>([]);
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [orderBusy, setOrderBusy] = useState(false);
  const [orderStatus, setOrderStatus] = useState("");
  const [testOrderId, setTestOrderId] = useState<number | null>(null);
  const [confirmAction, setConfirmAction] = useState<DiagnosticConfirmKind | null>(null);

  const availableProducts = useMemo(
    () => products.filter(product => product.ativo && product.disponivel && product.estoque - product.estoque_reservado > 0),
    [products]
  );

  const selectedProduct = availableProducts.find(product => String(product.id) === productId) || null;
  const maxQuantity = selectedProduct
    ? Math.max(1, selectedProduct.estoque - selectedProduct.estoque_reservado)
    : 1;
  const safeQuantity = Math.min(Math.max(1, quantity), maxQuantity);

  async function reloadProducts() {
    const items = await listProducts();
    setProducts(items);
    const selectedStillAvailable = items.find(product =>
      String(product.id) === productId &&
      product.ativo &&
      product.disponivel &&
      product.estoque - product.estoque_reservado > 0
    );
    if (selectedStillAvailable) return;
    const first = items.find(product => product.ativo && product.disponivel && product.estoque - product.estoque_reservado > 0);
    setProductId(first ? String(first.id) : "");
    setQuantity(1);
  }

  async function loadActiveTestOrder() {
    const value = await requestJson<OrderListResponse>("/api/admin/orders");
    const active = (value.pedidos || []).find(order =>
      Boolean(order.pedido_teste) &&
      !Boolean(order.arquivado) &&
      String(order.status_pedido || "").toUpperCase() !== "CANCELADO"
    );
    setTestOrderId(active ? Number(active.id) : null);
    if (active) setOrderStatus(`Pedido de teste #${active.id} ativo. Descarte-o ao terminar o cenário.`);
  }

  useEffect(() => {
    if (!owner) return;
    void reloadProducts().catch(() => setOrderStatus("Não foi possível carregar os produtos para teste."));
    void loadActiveTestOrder().catch(() => {});

    void requestJson<PixDiagnostic>("/api/admin/health/pix-real?latest=1")
      .then(value => {
        if (!value.diagnostico) return;
        setPix(value);
        setPixStatus(value.status === "PAGO" ? "Último Pix confirmado" : `Último teste: ${String(value.status || "PENDENTE").toLowerCase()}`);
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner]);

  useEffect(() => {
    if (!owner || !pix?.order_id || String(pix.status || "").toUpperCase() !== "PENDENTE") return;
    const timer = window.setInterval(() => {
      void requestJson<PixDiagnostic>(`/api/admin/health/pix-real?order_id=${encodeURIComponent(pix.order_id || "")}`)
        .then(value => {
          setPix(value);
          const status = String(value.status || "PENDENTE").toUpperCase();
          setPixStatus(status === "PAGO" ? "Pagamento confirmado pelo Mercado Pago" : `Status: ${status.toLowerCase()}`);
        })
        .catch(() => {});
    }, 3000);
    return () => window.clearInterval(timer);
  }, [owner, pix?.order_id, pix?.status]);

  if (!owner) return null;

  async function generatePix() {
    if (pixBusy) return;
    setPixBusy(true);
    setPixStatus("Gerando cobrança real…");
    try {
      const value = await requestJson<PixDiagnostic>("/api/admin/health/pix-real", { method: "POST" });
      setPix(value);
      setPixStatus("Pix gerado. Aguardando pagamento…");
    } catch (error) {
      setPixStatus(error instanceof Error ? error.message : "Não foi possível gerar o Pix de teste.");
    } finally {
      setPixBusy(false);
    }
  }

  async function refreshPix() {
    if (!pix?.order_id || pixBusy) return;
    setPixBusy(true);
    try {
      const value = await requestJson<PixDiagnostic>(`/api/admin/health/pix-real?order_id=${encodeURIComponent(pix.order_id)}`);
      setPix(value);
      setPixStatus(`Status: ${String(value.status || "PENDENTE").toLowerCase()}`);
    } catch (error) {
      setPixStatus(error instanceof Error ? error.message : "Não foi possível consultar o Pix.");
    } finally {
      setPixBusy(false);
    }
  }

  async function refundPix() {
    if (!pix?.order_id || pixBusy) return;
    setPixBusy(true);
    setPixStatus("Solicitando reembolso…");
    try {
      const value = await requestJson<PixDiagnostic>("/api/admin/health/pix-real-refund", {
        method: "POST",
        body: JSON.stringify({ order_id: pix.order_id })
      });
      setPix(current => ({ ...current, ...value, status: value.reembolsado ? "REEMBOLSADO" : current?.status }));
      setPixStatus(value.reembolsado ? "Pix reembolsado ✓" : "Reembolso em processamento…");
    } catch (error) {
      setPixStatus(error instanceof Error ? error.message : "Não foi possível reembolsar o Pix.");
    } finally {
      setPixBusy(false);
    }
  }

  async function createTestOrder() {
    if (!selectedProduct || orderBusy || testOrderId) return;
    setOrderBusy(true);
    setOrderStatus("Criando pedido de teste…");
    try {
      const value = await requestJson<OrderTestResult>("/api/admin/orders", {
        method: "POST",
        body: JSON.stringify({
          pedido_teste: true,
          itens: [{ produto_id: selectedProduct.id, quantidade: safeQuantity }],
          metodo_pagamento: "A_COMBINAR",
          status_pagamento: "PENDENTE"
        })
      });
      setTestOrderId(value.id);
      setOrderStatus(`Pedido de teste #${value.id} criado. O estoque foi reservado.`);
      await reloadProducts();
    } catch (error) {
      setOrderStatus(error instanceof Error ? error.message : "Não foi possível criar o pedido de teste.");
    } finally {
      setOrderBusy(false);
    }
  }

  async function discardTestOrder() {
    if (!testOrderId || orderBusy) return;
    const currentId = testOrderId;
    setOrderBusy(true);
    setOrderStatus(`Descartando pedido de teste #${currentId}…`);
    try {
      await requestJson(`/api/admin/orders/${currentId}/discard-test`, { method: "POST" });
      setTestOrderId(null);
      setOrderStatus(`Pedido de teste #${currentId} descartado. Estoque e financeiro simulados foram limpos.`);
      await reloadProducts();
    } catch (error) {
      setOrderStatus(error instanceof Error ? error.message : "Não foi possível descartar o pedido de teste.");
    } finally {
      setOrderBusy(false);
    }
  }

  function confirmCurrentAction() {
    if (confirmAction === "PIX") {
      void generatePix();
      return;
    }
    if (confirmAction === "REFUND") {
      void refundPix();
      return;
    }
    if (confirmAction === "ORDER") {
      void createTestOrder();
      return;
    }
    if (confirmAction === "DISCARD_ORDER") {
      void discardTestOrder();
    }
  }

  return (
    <>
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <div>
            <span className={styles.kicker}>Diagnósticos permanentes</span>
            <h3>Testes operacionais</h3>
            <p>Ferramentas isoladas para validar pagamento e fluxo de pedido sem contaminar o faturamento.</p>
          </div>
          <span className={styles.ownerBadge}>OWNER</span>
        </div>

        <div className={styles.grid}>
          <article className={styles.card}>
            <div className={styles.cardHead}>
              <div><strong>Pix real de diagnóstico</strong><p>Gera R$ 0,10 fora dos pedidos e do faturamento.</p></div>
              <span className={styles.realBadge}>REAL</span>
            </div>

            <div className={styles.status}>{pixStatus}</div>

            {pix?.qr_code_base64 ? (
              <div className={styles.pixResult}>
                <img className={styles.qr} src={`data:image/png;base64,${pix.qr_code_base64}`} alt="QR Code do Pix de diagnóstico" />
                <div className={styles.codeBox}>
                  <small>Pix copia e cola</small>
                  <textarea readOnly value={pix.qr_code || ""} />
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    onClick={() => void navigator.clipboard.writeText(pix.qr_code || "")}
                    disabled={!pix.qr_code}
                  >
                    Copiar código
                  </button>
                </div>
              </div>
            ) : null}

            <div className={styles.actions}>
              <button
                type="button"
                className={styles.primaryButton}
                disabled={pixBusy}
                onClick={() => setConfirmAction("PIX")}
              >
                {pixBusy ? "Processando…" : "Gerar Pix de R$ 0,10"}
              </button>
              {pix?.order_id ? (
                <button type="button" className={styles.secondaryButton} disabled={pixBusy} onClick={() => void refreshPix()}>
                  Consultar agora
                </button>
              ) : null}
              {String(pix?.status || "").toUpperCase() === "PAGO" ? (
                <button
                  type="button"
                  className={styles.secondaryButton}
                  disabled={pixBusy}
                  onClick={() => setConfirmAction("REFUND")}
                >
                  Reembolsar teste
                </button>
              ) : null}
            </div>
            {pix?.order_id ? <small className={styles.meta}>Order {pix.order_id} · {money(Number(pix.valor_centavos || 10))}</small> : null}
          </article>

          <article className={styles.card}>
            <div className={styles.cardHead}>
              <div><strong>Pedido de produto de teste</strong><p>Cria uma comanda de diagnóstico para exercitar estoque, pagamento, troca e reabertura.</p></div>
              <span className={styles.testBadge}>TESTE</span>
            </div>

            <label className={styles.field}>
              <span>Produto</span>
              <AdminSelect
                className={styles.selectControl}
                value={productId}
                ariaLabel="Produto do pedido de teste"
                disabled={Boolean(testOrderId) || orderBusy}
                options={availableProducts.map(product => ({
                  value: String(product.id),
                  label: `${product.nome} · ${product.estoque - product.estoque_reservado} disp.`
                }))}
                onChange={value => {
                  setProductId(value);
                  setQuantity(1);
                }}
              />
            </label>

            <label className={styles.field}>
              <span>Quantidade</span>
              <input
                type="number"
                min={1}
                max={maxQuantity}
                disabled={Boolean(testOrderId) || orderBusy}
                value={quantity}
                onChange={event => setQuantity(Math.min(maxQuantity, Math.max(1, Number(event.target.value) || 1)))}
              />
            </label>

            <div className={styles.notice}>
              Usa estoque real para o teste ser fiel. Só é permitido um pedido de diagnóstico ativo por vez e ele fica fora das métricas de venda.
            </div>
            {orderStatus ? <div className={styles.status}>{orderStatus}</div> : null}

            <div className={styles.actions}>
              {!testOrderId ? (
                <button
                  type="button"
                  className={styles.primaryButton}
                  disabled={orderBusy || !selectedProduct}
                  onClick={() => setConfirmAction("ORDER")}
                >
                  {orderBusy ? "Criando…" : "Criar pedido de teste"}
                </button>
              ) : (
                <>
                  <button type="button" className={styles.secondaryButton} disabled={orderBusy} onClick={() => onNavigate("pedidos")}>
                    Abrir pedido #{testOrderId}
                  </button>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    disabled={orderBusy}
                    onClick={() => setConfirmAction("DISCARD_ORDER")}
                  >
                    {orderBusy ? "Descartando…" : "Descartar pedido de teste"}
                  </button>
                </>
              )}
            </div>
          </article>
        </div>
      </section>

      {confirmAction ? (
        <StoreDiagnosticsConfirmDialog
          kind={confirmAction}
          productName={selectedProduct?.nome}
          quantity={safeQuantity}
          orderId={testOrderId}
          onClose={() => setConfirmAction(null)}
          onConfirm={confirmCurrentAction}
        />
      ) : null}
    </>
  );
}
