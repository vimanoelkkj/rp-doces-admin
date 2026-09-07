from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def patch(path, old, new):
    p = ROOT / path
    text = p.read_text(encoding='utf-8')
    if old not in text:
        raise SystemExit(f'pattern not found in {path}: {old[:100]!r}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')

# Web: preserve diagnostic marker in parsed orders.
patch(
    'admin/src/orders/order.schema.ts',
    '  reserva_status: z.string().nullable().optional(),\n  itens: z.array(OrderItemSchema).default([])',
    '  reserva_status: z.string().nullable().optional(),\n  pedido_teste: z.coerce.boolean().optional(),\n  arquivado: z.coerce.boolean().optional(),\n  itens: z.array(OrderItemSchema).default([])'
)

# Web: payment registration from the Comanda tab and no direct paid toggle for tests.
patch(
    'admin/src/orders/OrdersPage.tsx',
    'import { getFinancialOrder, type FinancialOrder, type FinancialOrderItem } from "./order.finance";',
    'import {\n  getFinancialOrder,\n  registerComandaPayment,\n  type FinancialOrder,\n  type FinancialOrderItem,\n  type ManualComandaPaymentMethod\n} from "./order.finance";'
)
patch(
    'admin/src/orders/OrdersPage.tsx',
    'const PAYMENT_STATUS_OPTIONS: Array<[ManualPaymentStatus, string]> = [\n  ["PENDENTE", "Pendente"],\n  ["PAGO", "Pago"],\n  ["CANCELADO", "Cancelado"]\n];',
    'const PAYMENT_STATUS_OPTIONS: Array<[ManualPaymentStatus, string]> = [\n  ["PENDENTE", "Pendente"],\n  ["PAGO", "Pago"],\n  ["CANCELADO", "Cancelado"]\n];\n\nconst MANUAL_PAYMENT_METHOD_OPTIONS: Array<[ManualComandaPaymentMethod, string]> = [\n  ["PIX_EXTERNO", "Pix direto"],\n  ["CARTAO", "Cartão"],\n  ["DINHEIRO", "Dinheiro"]\n];'
)
patch(
    'admin/src/orders/OrdersPage.tsx',
    '  const [editError, setEditError] = useState<string | null>(null);\n  const editingRef = useRef(false);',
    '  const [editError, setEditError] = useState<string | null>(null);\n  const [registeringPayment, setRegisteringPayment] = useState(false);\n  const [registerPaymentError, setRegisterPaymentError] = useState<string | null>(null);\n  const [registerPaymentMethod, setRegisterPaymentMethod] = useState<ManualComandaPaymentMethod>("DINHEIRO");\n  const editingRef = useRef(false);'
)
patch(
    'admin/src/orders/OrdersPage.tsx',
    '  const selectedIsManual = selected?.origem_pedido === "MANUAL";',
    '  const selectedIsManual = selected?.origem_pedido === "MANUAL";\n  const selectedIsDiagnostic = Boolean(selected?.pedido_teste);'
)
patch(
    'admin/src/orders/OrdersPage.tsx',
    '    setDeleteItemError(null);\n    setEditError(null);\n  }',
    '    setDeleteItemError(null);\n    setEditError(null);\n    setRegisterPaymentError(null);\n    setRegisterPaymentMethod("DINHEIRO");\n  }'
)
patch(
    'admin/src/orders/OrdersPage.tsx',
    '    const currentPayment = selected.origem_pedido === "MANUAL"\n      ? normalizeManualPayment(selected)\n      : null;',
    '    const currentPayment = selected.origem_pedido === "MANUAL" && !selected.pedido_teste\n      ? normalizeManualPayment(selected)\n      : null;'
)
patch(
    'admin/src/orders/OrdersPage.tsx',
    '  async function confirmDeleteItem() {',
    '''  async function registerSelectedDiagnosticPayment() {\n    if (!selected || !selectedIsDiagnostic || registeringPayment || pendingCents <= 0) return;\n    setRegisteringPayment(true);\n    setRegisterPaymentError(null);\n    try {\n      await registerComandaPayment(selected.id, {\n        metodo: registerPaymentMethod,\n        valor_centavos: pendingCents\n      });\n      await reload(selected.id);\n      const refreshedFinancial = await getFinancialOrder(selected.id, true);\n      setFinancial(refreshedFinancial);\n    } catch (err) {\n      setRegisterPaymentError(\n        err instanceof ApiClientError || err instanceof Error\n          ? err.message\n          : "Não foi possível registrar o pagamento do teste."\n      );\n    } finally {\n      setRegisteringPayment(false);\n    }\n  }\n\n  async function confirmDeleteItem() {'''
)
patch(
    'admin/src/orders/OrdersPage.tsx',
    '''                          {selectedIsManual ? (\n                            <AdminSelect\n                              value={draftPayment}\n                              ariaLabel="Status do pagamento"\n                              style={editSelectStyle}\n                              disabled={savingEdit}\n                              options={PAYMENT_STATUS_OPTIONS.map(([value, label]) => ({ value, label }))}\n                              onChange={value => setDraftPayment(value)}\n                            />\n                          ) : (\n                            <div className={styles.note}>O pagamento deste pedido é controlado pela comanda financeira.</div>\n                          )}''',
    '''                          {selectedIsDiagnostic ? (\n                            <div className={styles.note}>\n                              Pedido de teste: registre o pagamento pela aba Comanda para escolher a forma de pagamento.\n                            </div>\n                          ) : selectedIsManual ? (\n                            <AdminSelect\n                              value={draftPayment}\n                              ariaLabel="Status do pagamento"\n                              style={editSelectStyle}\n                              disabled={savingEdit}\n                              options={PAYMENT_STATUS_OPTIONS.map(([value, label]) => ({ value, label }))}\n                              onChange={value => setDraftPayment(value)}\n                            />\n                          ) : (\n                            <div className={styles.note}>O pagamento deste pedido é controlado pela comanda financeira.</div>\n                          )}'''
)
patch(
    'admin/src/orders/OrdersPage.tsx',
    '''                      <div className={styles["comanda-summary"]}>\n                        <div className={cls("summary-row", "total")}>\n                          <span>Total da comanda</span>\n                          <span>{money(financial?.valor_total_centavos ?? selected.valor_total_centavos)}</span>\n                        </div>\n                        <div className={cls("summary-row", "paid")}>\n                          <span>Pago</span>\n                          <span>{money(paidCents)}</span>\n                        </div>\n                        <div className={cls("summary-row", "pending")}>\n                          <span>Pendente</span>\n                          <span>{money(pendingCents)}</span>\n                        </div>\n                      </div>''',
    '''                      <div className={styles["comanda-summary"]}>\n                        <div className={cls("summary-row", "total")}>\n                          <span>Total da comanda</span>\n                          <span>{money(financial?.valor_total_centavos ?? selected.valor_total_centavos)}</span>\n                        </div>\n                        <div className={cls("summary-row", "paid")}>\n                          <span>Pago</span>\n                          <span>{money(paidCents)}</span>\n                        </div>\n                        <div className={cls("summary-row", "pending")}>\n                          <span>Pendente</span>\n                          <span>{money(pendingCents)}</span>\n                        </div>\n                      </div>\n\n                      {selectedIsDiagnostic && !selectedCommandClosed && pendingCents > 0 ? (\n                        <div style={{ marginTop: 16, display: "grid", gap: 10 }}>\n                          <div className={styles.note}>\n                            <strong style={{ display: "block", marginBottom: 6, color: "var(--text)" }}>Registrar pagamento do teste</strong>\n                            Escolha a forma de pagamento. Nada é cobrado de verdade neste fluxo manual.\n                          </div>\n                          <AdminSelect\n                            value={registerPaymentMethod}\n                            ariaLabel="Forma de pagamento do pedido de teste"\n                            style={editSelectStyle}\n                            disabled={registeringPayment}\n                            options={MANUAL_PAYMENT_METHOD_OPTIONS.map(([value, label]) => ({ value, label }))}\n                            onChange={value => setRegisterPaymentMethod(value)}\n                          />\n                          {registerPaymentError ? (\n                            <div className={styles.note} role="alert" style={{ color: "var(--pink-strong)" }}>\n                              {registerPaymentError}\n                            </div>\n                          ) : null}\n                          <button\n                            className={styles["primary-btn"]}\n                            type="button"\n                            disabled={registeringPayment}\n                            onClick={() => void registerSelectedDiagnosticPayment()}\n                          >\n                            {registeringPayment ? "Registrando..." : `Registrar ${money(pendingCents)} como pago`}\n                          </button>\n                        </div>\n                      ) : null}'''
)

# Backend: diagnostic orders must use the ledger payment endpoint, never the status selector.
patch(
    'functions/api/admin/orders/[id].js',
    '    `SELECT id, origem_pedido, status_pedido, status_pagamento, status_comanda, reserva_status,\n            estoque_baixado_em, valor_total_centavos\n     FROM pedidos WHERE id = ? LIMIT 1`',
    '    `SELECT id, origem_pedido, status_pedido, status_pagamento, status_comanda, reserva_status,\n            estoque_baixado_em, valor_total_centavos, idempotency_key\n     FROM pedidos WHERE id = ? LIMIT 1`'
)
patch(
    'functions/api/admin/orders/[id].js',
    '    let result;\n    if (nextPayment === "PAGO") result = await confirmarPagamentoManual(env, pedido, auth.user.id);',
    '''    const diagnostic = String(pedido.idempotency_key || "").startsWith("diagnostic-order:");\n    if (diagnostic && nextPayment === "PAGO") {\n      return json({\n        erro: "Pedido de teste deve registrar o pagamento pela comanda, escolhendo a forma de pagamento.",\n        codigo: "PAGAMENTO_TESTE_REQUER_COMANDA"\n      }, 409);\n    }\n\n    let result;\n    if (nextPayment === "PAGO") result = await confirmarPagamentoManual(env, pedido, auth.user.id);'''
)

# Financial list exposes the diagnostic marker so Android can enforce the same UI rule.
patch(
    'functions/api/admin/orders/finance.js',
    '            mp_order_id, mp_payment_id, mp_status, mp_status_detail,\n            criado_em, atualizado_em, pago_em\n     FROM pedidos',
    '            mp_order_id, mp_payment_id, mp_status, mp_status_detail,\n            criado_em, atualizado_em, pago_em,\n            CASE WHEN idempotency_key LIKE \'diagnostic-order:%\' THEN 1 ELSE 0 END AS pedido_teste\n     FROM pedidos'
)

# Android repository exposes the diagnostic marker and ledger registration.
patch(
    'apps/android/app/src/main/java/br/com/rpdoces/admin/data/orders/OrdersRepository.kt',
    '    @SerialName("pago_em") val paidAt: String? = null,\n    val itens: List<OrderItem> = emptyList()',
    '    @SerialName("pago_em") val paidAt: String? = null,\n    @SerialName("pedido_teste") val testOrder: Int = 0,\n    val itens: List<OrderItem> = emptyList()'
)
patch(
    'apps/android/app/src/main/java/br/com/rpdoces/admin/data/orders/OrdersRepository.kt',
    '    suspend fun updateItem(id: Int, itemId: Int, productId: Int, quantity: Int) {',
    '''    suspend fun registerManualPayment(id: Int, method: String, valueCents: Int) {\n        require(valueCents > 0) { "O valor do pagamento deve ser maior que zero." }\n        val normalizedMethod = method.uppercase()\n        if (normalizedMethod !in setOf("PIX_EXTERNO", "CARTAO", "DINHEIRO")) {\n            throw OrdersException("Forma de pagamento inválida.", 400)\n        }\n        api.registerPayment(\n            id,\n            RegisterPaymentRequest(\n                metodo = normalizedMethod,\n                valueCents = valueCents,\n                pixDecision = "CANCELAR"\n            )\n        ).requireSuccess("Não foi possível registrar o pagamento da comanda.")\n    }\n\n    suspend fun updateItem(id: Int, itemId: Int, productId: Int, quantity: Int) {'''
)

# Android: choose the payment method from Comanda for diagnostic orders.
patch(
    'apps/android/app/src/main/java/br/com/rpdoces/admin/ui/orders/OrdersScreen.kt',
    'private val paymentOptions = listOf(\n    "PENDENTE" to "Pendente",\n    "PAGO" to "Pago"\n)',
    'private val paymentOptions = listOf(\n    "PENDENTE" to "Pendente",\n    "PAGO" to "Pago"\n)\n\nprivate val manualPaymentMethodOptions = listOf(\n    "PIX_EXTERNO" to "Pix direto",\n    "CARTAO" to "Cartão",\n    "DINHEIRO" to "Dinheiro"\n)'
)
patch(
    'apps/android/app/src/main/java/br/com/rpdoces/admin/ui/orders/OrdersScreen.kt',
    '    var paymentOpen by remember { mutableStateOf(false) }\n    var saving by remember { mutableStateOf(false) }',
    '    var paymentOpen by remember { mutableStateOf(false) }\n    var manualPaymentMethod by remember(order.id) { mutableStateOf("DINHEIRO") }\n    var manualPaymentMethodOpen by remember { mutableStateOf(false) }\n    var saving by remember { mutableStateOf(false) }'
)
patch(
    'apps/android/app/src/main/java/br/com/rpdoces/admin/ui/orders/OrdersScreen.kt',
    '    val hasChanges = statusDirty || paymentDirty',
    '    val isDiagnosticOrder = order.testOrder == 1\n    val hasChanges = statusDirty || (paymentDirty && !isDiagnosticOrder)'
)
patch(
    'apps/android/app/src/main/java/br/com/rpdoces/admin/ui/orders/OrdersScreen.kt',
    '''                                        SelectorField(\n                                            label = "Pagamento",\n                                            selectedKey = payment,\n                                            value = paymentOptions.firstOrNull { it.first == payment }?.second ?: payment,\n                                            expanded = paymentOpen,\n                                            onExpand = { paymentOpen = true },\n                                            onDismiss = { paymentOpen = false },\n                                            options = paymentOptions,\n                                            onSelect = { selectedPayment ->\n                                                payment = selectedPayment\n                                                paymentDirty = selectedPayment != effectiveFinancialStatus(order)\n                                                paymentOpen = false\n                                            }\n                                        )''',
    '''                                        if (isDiagnosticOrder) {\n                                            Text(\n                                                "Pedido de teste: escolha a forma de pagamento na aba Comanda.",\n                                                color = web.muted,\n                                                fontSize = 11.5.sp,\n                                                lineHeight = 17.sp\n                                            )\n                                        } else {\n                                            SelectorField(\n                                                label = "Pagamento",\n                                                selectedKey = payment,\n                                                value = paymentOptions.firstOrNull { it.first == payment }?.second ?: payment,\n                                                expanded = paymentOpen,\n                                                onExpand = { paymentOpen = true },\n                                                onDismiss = { paymentOpen = false },\n                                                options = paymentOptions,\n                                                onSelect = { selectedPayment ->\n                                                    payment = selectedPayment\n                                                    paymentDirty = selectedPayment != effectiveFinancialStatus(order)\n                                                    paymentOpen = false\n                                                }\n                                            )\n                                        }'''
)
patch(
    'apps/android/app/src/main/java/br/com/rpdoces/admin/ui/orders/OrdersScreen.kt',
    '''                                DetailLine("Total", money(order.totalCents))\n                                DetailLine("Pago", money(order.paidCents))\n                                DetailLine("Restante", money(order.balanceCents), strong = true)\n                            }''',
    '''                                DetailLine("Total", money(order.totalCents))\n                                DetailLine("Pago", money(order.paidCents))\n                                DetailLine("Restante", money(order.balanceCents), strong = true)\n                                if (isDiagnosticOrder && !commandClosed && order.balanceCents > 0) {\n                                    Spacer(Modifier.height(14.dp))\n                                    Text(\n                                        "Registrar pagamento do teste",\n                                        color = web.text,\n                                        fontSize = 12.sp,\n                                        fontWeight = FontWeight.Bold\n                                    )\n                                    Text(\n                                        "Escolha a forma. Este registro é manual e não cobra dinheiro de verdade.",\n                                        color = web.muted,\n                                        fontSize = 10.5.sp,\n                                        lineHeight = 15.sp,\n                                        modifier = Modifier.padding(top = 4.dp, bottom = 8.dp)\n                                    )\n                                    SelectorField(\n                                        label = "Forma de pagamento",\n                                        selectedKey = manualPaymentMethod,\n                                        value = manualPaymentMethodOptions.firstOrNull { it.first == manualPaymentMethod }?.second ?: manualPaymentMethod,\n                                        expanded = manualPaymentMethodOpen,\n                                        onExpand = { manualPaymentMethodOpen = true },\n                                        onDismiss = { manualPaymentMethodOpen = false },\n                                        options = manualPaymentMethodOptions,\n                                        onSelect = { selectedMethod ->\n                                            manualPaymentMethod = selectedMethod\n                                            manualPaymentMethodOpen = false\n                                        }\n                                    )\n                                    Spacer(Modifier.height(10.dp))\n                                    Surface(\n                                        onClick = {\n                                            if (!saving) {\n                                                saving = true\n                                                error = null\n                                                scope.launch {\n                                                    runCatching {\n                                                        repository.registerManualPayment(order.id, manualPaymentMethod, order.balanceCents)\n                                                    }.onSuccess {\n                                                        onUpdated()\n                                                        onDismiss()\n                                                    }.onFailure {\n                                                        error = it.message ?: "Não foi possível registrar o pagamento do teste."\n                                                    }\n                                                    saving = false\n                                                }\n                                            }\n                                        },\n                                        enabled = !saving,\n                                        modifier = Modifier.fillMaxWidth().height(42.dp),\n                                        shape = RoundedCornerShape(9.dp),\n                                        color = web.accent,\n                                        border = BorderStroke(1.dp, web.accentDark)\n                                    ) {\n                                        Box(contentAlignment = Alignment.Center) {\n                                            Text(\n                                                if (saving) "Registrando..." else "Registrar ${money(order.balanceCents)} como pago",\n                                                color = Color.White,\n                                                fontSize = 11.5.sp,\n                                                fontWeight = FontWeight.Bold\n                                            )\n                                        }\n                                    }\n                                }\n                            }'''
)
patch(
    'apps/android/app/src/main/java/br/com/rpdoces/admin/ui/orders/OrdersScreen.kt',
    '                                            if (paymentDirty) repository.updatePayment(order.id, payment)\n                                            if (statusDirty) repository.updateStatus(order.id, status)',
    '                                            if (paymentDirty && !isDiagnosticOrder) repository.updatePayment(order.id, payment)\n                                            if (statusDirty) repository.updateStatus(order.id, status)'
)

# Basic regression test: parsed diagnostic marker and backend guard source remain explicit.
test_path = ROOT / 'tests/diagnostic-payment-flow.test.mjs'
test_path.write_text('''import test from "node:test";\nimport assert from "node:assert/strict";\nimport fs from "node:fs";\nimport { OrderSchema } from "../admin/src/orders/order.schema.ts";\n\ntest("order schema preserves diagnostic marker", () => {\n  const parsed = OrderSchema.parse({ id: 24, pedido_teste: 1 });\n  assert.equal(parsed.pedido_teste, true);\n});\n\ntest("diagnostic order cannot be paid by generic status selector", () => {\n  const source = fs.readFileSync(new URL("../functions/api/admin/orders/[id].js", import.meta.url), "utf8");\n  assert.match(source, /PAGAMENTO_TESTE_REQUER_COMANDA/);\n  assert.match(source, /deve registrar o pagamento pela comanda/);\n});\n''', encoding='utf-8')

print('diagnostic payment flow patched')
