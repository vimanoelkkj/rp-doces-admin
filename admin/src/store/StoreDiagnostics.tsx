import { useEffect, useMemo, useState } from "react";
import type { AuthSession } from "../auth/AuthGate";
import type { AdminV2Page } from "../layout/AdminShell";
import { listProducts } from "../products/product.api";
import type { Product } from "../products/product.types";
import { AdminSelect } from "../shared/AdminSelect";
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

  const availableProducts = useMemo(
    () => products.filter(product => product.ativo && product.disponivel && product.estoque - product.estoque_reservado > 0),
    [products]
  );

  const selectedProduct = availableProducts.find(product => String(product.id) === productId) || null;
  const maxQuantity = selectedProduct
    ? Math.max(1, selectedProduct.estoque - selectedProduct.estoque_reservado)
    : 1;

  useEffect(() => {
    if (!owner) return;
    void listProducts()
      .then(items => {
        setProducts(items);
        const first = items.find(product => product.ativo && product.disponivel && product.estoque - product.estoque_reservado > 0);
        if (first) setProductId(String(first.id));
      })
      .catch(() => setOrderStatus("Não foi possível carregar os produtos para teste."));

    void requestJson<PixDiagnostic>("/api/admin/health/pix-real?latest=1")
      .then(value => {
        if (!value.diagnostico) return;
        setPix(value);
        setPixStatus(value.status === "PAGO" ? "Último Pix confirmado" : `Último teste: ${String(value.status || "PENDENTE").toLowerCase()}`);
      })
      .catch(() => {});
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
    if (!window.confirm("Este teste cria um Pix REAL de R$ 0,10 usando a credencial de diagnóstico. Continuar?")) return;
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
    if (!window.confirm("Solicitar o reembolso REAL deste Pix de diagnóstico?")) return;
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
    if (!selectedProduct || orderBusy) return;
    const safeQuantity = Math.min(Math.max(1, quantity), maxQuantity);
    if (!window.confirm(`Criar pedido de teste com ${safeQuantity}x ${selectedProduct.nome}? Ele vai reservar estoque real, mas não entra no faturamento.`)) return;
    setOrderBusy(true);
    setOrderStatus("Criando pedido de teste…");
    setTestOrderId(null);
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
    } catch (error) {
      setOrderStatus(error instanceof Error ? error.message : "Não foi possível criar o pedido de teste.");
    } finally {
      setOrderBusy(false);
    }
  }

  return (
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
            <button type="button" className={styles.primaryButton} disabled={pixBusy} onClick={() => void generatePix()}>
              {pixBusy ? "Processando…" : "Gerar Pix de R$ 0,10"}
            </button>
            {pix?.order_id ? (
              <button type="button" className={styles.secondaryButton} disabled={pixBusy} onClick={() => void refreshPix()}>
                Consultar agora
              </button>
            ) : null}
            {String(pix?.status || "").toUpperCase() === "PAGO" ? (
              <button type="button" className={styles.secondaryButton} disabled={pixBusy} onClick={() => void refundPix()}>
                Reembolsar teste
              </button>
            ) : null}
          </div>
          {pix?.order_id ? <small className={styles.meta}>Order {pix.order_id} · {money(Number(pix.valor_centavos || 10))}</small> : null}
        </article>

        <article className={styles.card}>
          <div className={styles.cardHead}>
            <div><strong>Pedido de produto de teste</strong><p>Cria uma comanda real de teste para exercitar estoque, pagamento, troca e reabertura.</p></div>
            <span className={styles.testBadge}>TESTE</span>
          </div>

          <label className={styles.field}>
            <span>Produto</span>
            <AdminSelect
              value={productId}
              ariaLabel="Produto do pedido de teste"
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
              value={quantity}
              onChange={event => setQuantity(Math.min(maxQuantity, Math.max(1, Number(event.target.value) || 1)))}
            />
          </label>

          <div className={styles.notice}>
            Usa estoque real para o teste ser fiel. O pedido recebe identificação de diagnóstico e fica excluído das métricas de venda.
          </div>
          {orderStatus ? <div className={styles.status}>{orderStatus}</div> : null}

          <div className={styles.actions}>
            <button
              type="button"
              className={styles.primaryButton}
              disabled={orderBusy || !selectedProduct}
              onClick={() => void createTestOrder()}
            >
              {orderBusy ? "Criando…" : "Criar pedido de teste"}
            </button>
            {testOrderId ? (
              <button type="button" className={styles.secondaryButton} onClick={() => onNavigate("pedidos")}>
                Abrir em Pedidos
              </button>
            ) : null}
          </div>
        </article>
      </div>
    </section>
  );
}
