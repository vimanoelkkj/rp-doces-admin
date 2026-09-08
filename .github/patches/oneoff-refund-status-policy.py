from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def patch(path, old, new):
    p = ROOT / path
    text = p.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"pattern not found in {path}: {old[:160]!r}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


# Backend: refund eligibility depends only on order status.
patch(
    "functions/api/admin/orders/[id]/refunds.js",
    'const MANUAL_METHODS = new Set(["PIX_EXTERNO", "DINHEIRO", "CARTAO", "OUTRO"]);\nconst CONFIRMED_MP_STATUSES = new Set(["approved", "processed", "refunded"]);\n',
    'const MANUAL_METHODS = new Set(["PIX_EXTERNO", "DINHEIRO", "CARTAO", "OUTRO"]);\nconst REFUNDABLE_ORDER_STATUSES = new Set(["NOVO", "PREPARANDO", "PRONTO"]);\nconst CONFIRMED_MP_STATUSES = new Set(["approved", "processed", "refunded"]);\n'
)

patch(
    "functions/api/admin/orders/[id]/refunds.js",
    '''  if (String(payment.status || "").toUpperCase() !== "PAGO") {
    return json({ erro: "Somente pagamentos confirmados podem ser reembolsados." }, 409);
  }

  const automatic = payment.metodo === "PIX_MP" && Boolean(payment.mp_order_id || payment.mp_payment_id);
''',
    '''  if (String(payment.status || "").toUpperCase() !== "PAGO") {
    return json({ erro: "Somente pagamentos confirmados podem ser reembolsados." }, 409);
  }

  const orderStatus = String(payment.status_pedido || "").trim().toUpperCase();
  if (!REFUNDABLE_ORDER_STATUSES.has(orderStatus)) {
    return json({
      erro: "Reembolso permitido apenas para pedidos pendentes, em produção ou prontos. Pedidos entregues ou cancelados não podem ser reembolsados."
    }, 409);
  }

  const automatic = payment.metodo === "PIX_MP" && Boolean(payment.mp_order_id || payment.mp_payment_id);
'''
)

# Full comanda/refund dialog: hide refund actions for delivered/cancelled orders.
patch(
    "admin/src/orders/ComandaDialog.tsx",
    'const REFUND_SYNC_MS = 3_000;\n\nconst PAYMENT_LABELS: Record<string, string> = {\n',
    'const REFUND_SYNC_MS = 3_000;\nconst REFUNDABLE_ORDER_STATUSES = new Set(["NOVO", "PREPARANDO", "PRONTO"]);\n\nconst PAYMENT_LABELS: Record<string, string> = {\n'
)

patch(
    "admin/src/orders/ComandaDialog.tsx",
    '''  const open = order?.status_comanda !== "ENCERRADA";
  const historyCount = (order?.pagamentos.length || 0) + refunds.length;

  return (
''',
    '''  const open = order?.status_comanda !== "ENCERRADA";
  const refundAllowedByStatus = REFUNDABLE_ORDER_STATUSES.has(String(order?.status_pedido || "").toUpperCase());
  const historyCount = (order?.pagamentos.length || 0) + refunds.length;

  return (
'''
)

patch(
    "admin/src/orders/ComandaDialog.tsx",
    '                  const canRefund = payment.status === "PAGO" && paymentId > 0 && !refundPending && !refundCompleted;\n',
    '                  const canRefund = refundAllowedByStatus && payment.status === "PAGO" && paymentId > 0 && !refundPending && !refundCompleted;\n'
)

patch(
    "admin/src/orders/ComandaDialog.tsx",
    '''                {order.pagamentos.map((payment, index) => {
''',
    '''                {!refundAllowedByStatus && order.pagamentos.some(payment => payment.status === "PAGO") ? (
                  <div className={styles.empty}>
                    Reembolso indisponível para pedidos entregues ou cancelados.
                  </div>
                ) : null}

                {order.pagamentos.map((payment, index) => {
'''
)

# Current Orders drawer: expose the existing robust refund flow.
patch(
    "admin/src/orders/OrdersPage.tsx",
    'import { ReallocateOrderItemDialog } from "./ReallocateOrderItemDialog";\n',
    'import { ReallocateOrderItemDialog } from "./ReallocateOrderItemDialog";\nimport { ComandaDialog } from "./ComandaDialog";\n'
)

patch(
    "admin/src/orders/OrdersPage.tsx",
    'const ORDER_AUTO_REFRESH_MS = 10_000;\nlet ordersCache: Order[] | null = null;\n',
    'const ORDER_AUTO_REFRESH_MS = 10_000;\nconst REFUNDABLE_ORDER_STATUSES = new Set(["NOVO", "PREPARANDO", "PRONTO"]);\nlet ordersCache: Order[] | null = null;\n'
)

patch(
    "admin/src/orders/OrdersPage.tsx",
    '''  const [registerPaymentError, setRegisterPaymentError] = useState<string | null>(null);
  const [registerPaymentMethod, setRegisterPaymentMethod] = useState<ManualComandaPaymentMethod>("DINHEIRO");
  const editingRef = useRef(false);
''',
    '''  const [registerPaymentError, setRegisterPaymentError] = useState<string | null>(null);
  const [registerPaymentMethod, setRegisterPaymentMethod] = useState<ManualComandaPaymentMethod>("DINHEIRO");
  const [refundOrderId, setRefundOrderId] = useState<number | null>(null);
  const editingRef = useRef(false);
'''
)

patch(
    "admin/src/orders/OrdersPage.tsx",
    '''  const selectedIsManual = selected?.origem_pedido === "MANUAL";
  const selectedIsDiagnostic = Boolean(selected?.pedido_teste);

  useEffect(() => {
''',
    '''  const selectedIsManual = selected?.origem_pedido === "MANUAL";
  const selectedIsDiagnostic = Boolean(selected?.pedido_teste);
  const selectedRefundAllowed = REFUNDABLE_ORDER_STATUSES.has(String(selected?.status_pedido || "").toUpperCase());

  useEffect(() => {
'''
)

patch(
    "admin/src/orders/OrdersPage.tsx",
    '''                      <div className={styles["comanda-summary"]}>
                        <div className={cls("summary-row", "total")}>
                          <span>Total da comanda</span>
                          <span>{money(financial?.valor_total_centavos ?? selected.valor_total_centavos)}</span>
                        </div>
                        <div className={cls("summary-row", "paid")}>
                          <span>Pago</span>
                          <span>{money(paidCents)}</span>
                        </div>
                        <div className={cls("summary-row", "pending")}>
                          <span>Pendente</span>
                          <span>{money(pendingCents)}</span>
                        </div>
                      </div>

                      {selectedIsDiagnostic && !selectedCommandClosed && pendingCents > 0 ? (
''',
    '''                      <div className={styles["comanda-summary"]}>
                        <div className={cls("summary-row", "total")}>
                          <span>Total da comanda</span>
                          <span>{money(financial?.valor_total_centavos ?? selected.valor_total_centavos)}</span>
                        </div>
                        <div className={cls("summary-row", "paid")}>
                          <span>Pago</span>
                          <span>{money(paidCents)}</span>
                        </div>
                        <div className={cls("summary-row", "pending")}>
                          <span>Pendente</span>
                          <span>{money(pendingCents)}</span>
                        </div>
                      </div>

                      {paidCents > 0 ? (
                        <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
                          {selectedRefundAllowed ? (
                            <button
                              className={styles["secondary-btn"]}
                              type="button"
                              style={{ color: "var(--danger)", borderColor: "var(--danger)" }}
                              onClick={() => setRefundOrderId(selected.id)}
                            >
                              Reembolsar pagamento
                            </button>
                          ) : (
                            <div className={styles.note}>
                              Reembolso indisponível para pedidos entregues ou cancelados.
                            </div>
                          )}
                        </div>
                      ) : null}

                      {selectedIsDiagnostic && !selectedCommandClosed && pendingCents > 0 ? (
'''
)

patch(
    "admin/src/orders/OrdersPage.tsx",
    '''      {selected && editingItem ? (
        <EditOrderItemDialog
''',
    '''      {refundOrderId ? (
        <ComandaDialog
          orderId={refundOrderId}
          onClose={() => setRefundOrderId(null)}
          onChanged={() => {
            const orderId = refundOrderId;
            void reload(orderId);
            void getFinancialOrder(orderId, true).then(value => {
              if (selected?.id === orderId) setFinancial(value);
            });
          }}
        />
      ) : null}

      {selected && editingItem ? (
        <EditOrderItemDialog
'''
)

# Static regression coverage for policy and UI wiring.
test_path = ROOT / "tests/refund-status-policy.test.mjs"
test_path.write_text('''import test from "node:test";\nimport assert from "node:assert/strict";\nimport fs from "node:fs";\n\nconst refundsApi = fs.readFileSync("functions/api/admin/orders/[id]/refunds.js", "utf8");\nconst ordersPage = fs.readFileSync("admin/src/orders/OrdersPage.tsx", "utf8");\nconst comandaDialog = fs.readFileSync("admin/src/orders/ComandaDialog.tsx", "utf8");\n\ntest("reembolso é permitido apenas para NOVO, PREPARANDO e PRONTO", () => {\n  assert.match(refundsApi, /REFUNDABLE_ORDER_STATUSES = new Set\\(\\["NOVO", "PREPARANDO", "PRONTO"\\]\\)/);\n  assert.match(refundsApi, /REFUNDABLE_ORDER_STATUSES\\.has\\(orderStatus\\)/);\n  assert.match(refundsApi, /Pedidos entregues ou cancelados não podem ser reembolsados/);\n});\n\ntest("drawer de pedidos expõe o fluxo de reembolso quando há valor pago", () => {\n  assert.match(ordersPage, /Reembolsar pagamento/);\n  assert.match(ordersPage, /<ComandaDialog/);\n  assert.match(ordersPage, /selectedRefundAllowed/);\n});\n\ntest("comanda não oferece reembolso para status bloqueado", () => {\n  assert.match(comandaDialog, /refundAllowedByStatus/);\n  assert.match(comandaDialog, /Reembolso indisponível para pedidos entregues ou cancelados/);\n  assert.match(comandaDialog, /const canRefund = refundAllowedByStatus/);\n});\n''', encoding="utf-8")
