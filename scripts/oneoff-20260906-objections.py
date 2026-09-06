from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: trecho esperado {count} vezes, esperado 1")
    p.write_text(text.replace(old, new), encoding="utf-8")


# Pedido de teste permanente: usa o mesmo fluxo manual/estoque real, mas recebe
# uma identidade diagnóstica excluída do faturamento.
replace_once(
    "functions/api/admin/orders/index.js",
    '''  const body = await bodyJson(request);
  const requested = normalizeManualItems(body?.itens);
  const method = String(body?.metodo_pagamento || "").toUpperCase();
  const paymentStatus = String(body?.status_pagamento || "PENDENTE").toUpperCase();
  const clienteNome = String(body?.cliente_nome || "").trim().slice(0, 120);
  const clienteWhatsapp = String(body?.cliente_whatsapp || "").trim().slice(0, 40);
  const observacao = String(body?.observacao || "").trim().slice(0, 500);
''',
    '''  const body = await bodyJson(request);
  const diagnosticOrder = body?.pedido_teste === true;
  if (diagnosticOrder && String(auth.user?.papel || "").toUpperCase() !== "OWNER") {
    return json({ erro: "Apenas o OWNER pode criar pedido de teste." }, 403);
  }

  const requested = normalizeManualItems(body?.itens);
  const method = diagnosticOrder
    ? "A_COMBINAR"
    : String(body?.metodo_pagamento || "").toUpperCase();
  const paymentStatus = diagnosticOrder
    ? "PENDENTE"
    : String(body?.status_pagamento || "PENDENTE").toUpperCase();
  const clienteNome = diagnosticOrder
    ? "🧪 Teste de pedido"
    : String(body?.cliente_nome || "").trim().slice(0, 120);
  const clienteWhatsapp = diagnosticOrder
    ? ""
    : String(body?.cliente_whatsapp || "").trim().slice(0, 40);
  const observacao = diagnosticOrder
    ? "PEDIDO DE TESTE INTERNO · usa estoque real, mas não entra no faturamento."
    : String(body?.observacao || "").trim().slice(0, 500);
''',
)
replace_once(
    "functions/api/admin/orders/index.js",
    '  const idempotencyKey = `manual:${crypto.randomUUID()}`;',
    '  const idempotencyKey = diagnosticOrder ? `diagnostic-order:${crypto.randomUUID()}` : `manual:${crypto.randomUUID()}`;',
)

# Restaura os dois diagnósticos dentro da tela atual da Loja.
replace_once(
    "admin/src/store/StorePage.tsx",
    'import { getStoreConfig, removeSiteImage, updateStoreConfig, uploadSiteImage } from "./store.api";',
    'import { getStoreConfig, removeSiteImage, updateStoreConfig, uploadSiteImage } from "./store.api";\nimport { StoreDiagnostics } from "./StoreDiagnostics";',
)
replace_once(
    "admin/src/store/StorePage.tsx",
    '''            </section>
          </div>
        </form>''',
    '''            </section>
            <StoreDiagnostics session={session} onNavigate={onNavigate} />
          </div>
        </form>''',
)

# Toda comanda encerrada oferece reabertura. O backend decide se preserva a
# baixa já feita ou reconstrói a reserva pendente.
replace_once(
    "admin/src/orders/OrdersPage.tsx",
    '''  const selectedCanceled = String(selected?.status_pedido || "").toUpperCase() === "CANCELADO" ||
    String(selected?.status_pagamento || "").toUpperCase() === "CANCELADO";
  const canReopenCommand = Boolean(selected && selectedCommandClosed && (paidCents > 0 || (selectedIsManual && selectedCanceled)));''',
    '''  const canReopenCommand = Boolean(selected && selectedCommandClosed);''',
)
replace_once(
    "admin/src/orders/OrdersPage.tsx",
    '''      if (paidCents > 0) {
        await reopenPaidCommand(selected.id);
      } else {
        await updateManualPayment(selected.id, "PENDENTE");
      }''',
    '''      await reopenPaidCommand(selected.id);''',
)

# Android usa a mesma operação unificada.
replace_once(
    "apps/android/app/src/main/java/br/com/rpdoces/admin/ui/orders/OrdersScreen.kt",
    '''    val canceledOrder = order.orderStatus.equals("CANCELADO", true) || order.paymentStatus.equals("CANCELADO", true)
    val hasConfirmedPayment = order.paidCents > 0 || effectiveFinancialStatus(order) in setOf("PAGO", "PARCIAL")
    val canReopenPaid = commandClosed && hasConfirmedPayment
    val canReopenCanceled = commandClosed && canceledOrder && !hasConfirmedPayment
    val canReopen = canReopenPaid || canReopenCanceled''',
    '''    val hasConfirmedPayment = order.paidCents > 0 || effectiveFinancialStatus(order) in setOf("PAGO", "PARCIAL")
    val canReopenPaid = commandClosed && hasConfirmedPayment
    val canReopen = commandClosed''',
)
replace_once(
    "apps/android/app/src/main/java/br/com/rpdoces/admin/ui/orders/OrdersScreen.kt",
    '''                                            if (canReopenPaid) repository.reopenPaidCommand(order.id)
                                            else repository.updatePayment(order.id, "PENDENTE")''',
    '''                                            repository.reopenPaidCommand(order.id)''',
)
replace_once(
    "apps/android/app/src/main/java/br/com/rpdoces/admin/ui/orders/OrdersScreen.kt",
    '"Esta comanda está cancelada e encerrada. Reabra a comanda para voltar a editar status e pagamento."',
    '"Esta comanda está encerrada. Ao reabrir, o sistema preserva baixas já feitas e reconstrói a reserva pendente quando necessário."',
)

# O faturamento diário da R&P segue a data original do pedido, não o instante
# em que um pagamento atrasado foi confirmado.
replace_once(
    "admin/src/dashboard/dashboard.model.ts",
    '''  const paidToday = orders.filter(
    order =>
      String(order.status_pagamento || "").toUpperCase() === "PAGO" &&
      sameLocalDay(parseDashboardDate(order.pago_em || order.atualizado_em), now)
  );''',
    '''  const paidToday = orders.filter(
    order =>
      String(order.status_pagamento || "").toUpperCase() === "PAGO" &&
      sameLocalDay(parseDashboardDate(order.criado_em), now)
  );''',
)
replace_once(
    "admin/src/dashboard/DashboardPage.tsx",
    '''    const paidOnSelectedDay = data.orders.flatMap(order =>
      order.pagamentos.filter(payment =>
        payment.status === "PAGO" &&
        sameLocalDay(parseDashboardDate(payment.pago_em || payment.atualizado_em), selectedDate)
      )
    );''',
    '''    const paidOnSelectedDay = data.orders
      .filter(order =>
        String(order.status_pedido || "").toUpperCase() !== "CANCELADO" &&
        sameLocalDay(parseDashboardDate(order.criado_em), selectedDate)
      )
      .flatMap(order => order.pagamentos.filter(payment => payment.status === "PAGO"));''',
)
replace_once(
    "admin/src/dashboard/DashboardPage.tsx",
    '''      const paidAt = parseDashboardDate(order.pago_em || order.atualizado_em || order.criado_em);
      if (order.status_financeiro !== "PAGO" || !paidAt || paidAt.getTime() < cutoff) return;''',
    '''      const saleAt = parseDashboardDate(order.criado_em);
      if (order.status_financeiro !== "PAGO" || !saleAt || saleAt.getTime() < cutoff) return;''',
)

replace_once(
    "apps/android/app/src/main/java/br/com/rpdoces/admin/data/dashboard/DashboardRepository.kt",
    '''    val paidPaymentsToday = orders.flatMap { order ->
        order.pagamentos.filter { payment ->
            payment.status.equals("PAGO", ignoreCase = true) &&
                sameDay(payment.paidAt ?: payment.updatedAt, today, zoneId)
        }
    }''',
    '''    val paidPaymentsToday = orders
        .filter { order ->
            !order.orderStatus.equals("CANCELADO", ignoreCase = true) &&
                sameDay(order.createdAt, today, zoneId)
        }
        .flatMap { order ->
            order.pagamentos.filter { payment -> payment.status.equals("PAGO", ignoreCase = true) }
        }''',
)

# Atualiza o teste de reabertura para a nova regra de comanda sem pagamento.
p = Path("tests/paid-command-reopen.test.mjs")
text = p.read_text(encoding="utf-8")
marker = 'test("não usa o fluxo pago para reabrir comanda sem pagamento confirmado"'
start = text.find(marker)
if start < 0:
    raise SystemExit("Teste antigo de reabertura não encontrado")
text = text[:start] + '''test("reabre comanda sem pagamento reconstruindo a reserva quando necessário", async () => {
  const order = paidClosedOrder({
    status_pedido: "CANCELADO",
    status_pagamento: "CANCELADO",
    reserva_status: "LIBERADA",
    estoque_baixado_em: null,
    valor_total_centavos: 2000
  });
  let reserved = false;
  const db = fakeDb(
    sql => {
      if (sql.includes("FROM admin_sessoes")) {
        return { first: () => ({ id: 1, nome: "Admin", ativo: 1, papel: "ADMIN" }) };
      }
      if (sql.includes("SELECT id, status_pedido") && sql.includes("FROM pedidos")) {
        return { first: () => order };
      }
      if (sql.includes("SUM(valor_centavos)") && sql.includes("pedido_pagamentos")) {
        return { first: () => ({ total_centavos: 0 }) };
      }
      if (sql.includes("SELECT produto_id, SUM(quantidade) AS quantidade")) {
        return { all: () => ({ results: [{ produto_id: 1, quantidade: 1 }] }) };
      }
      if (sql.includes("SELECT id, ativo, estoque, estoque_reservado")) {
        return { first: () => ({ id: 1, ativo: 1, estoque: 5, estoque_reservado: 0 }) };
      }
      if (sql.includes("SELECT * FROM pedidos WHERE id = ? LIMIT 1")) {
        return { first: () => ({ ...order, status_pedido: "NOVO", status_pagamento: "PENDENTE", status_comanda: "ABERTA", reserva_status: "ATIVA" }) };
      }
      if (sql.includes("FROM pedido_itens") && sql.includes("ORDER BY id")) {
        return { all: () => ({ results: [{ id: 101, pedido_id: 18, produto_id: 1, produto_nome: "Encanto", quantidade: 1, valor_unitario_centavos: 2000, valor_total_centavos: 2000, estoque_baixado_em: null }] }) };
      }
      if (sql.includes("FROM pedido_pagamentos") && sql.includes("ORDER BY criado_em")) {
        return { all: () => ({ results: [] }) };
      }
      return {};
    },
    async statements => {
      if (statements.some(statement => statement.sql.includes("estoque_reservado = estoque_reservado +"))) reserved = true;
      return statements.map(() => ({ success: true, meta: { changes: 1 } }));
    }
  );

  const response = await reopenPaidCommand({
    request: request(),
    params: { id: "18" },
    env: { DB: db }
  });
  const body = await responseJson(response);

  assert.equal(response.status, 200);
  assert.equal(body.status_comanda, "ABERTA");
  assert.equal(body.status_pagamento, "PENDENTE");
  assert.equal(body.reserva_reconstruida, true);
  assert.equal(reserved, true);
});
'''
p.write_text(text, encoding="utf-8")

Path("tests/dashboard-sale-date.test.mjs").write_text(
    '''import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("dashboard atribui pagamento tardio à data original do pedido", () => {
  const api = readFileSync("functions/api/admin/dashboard/metrics.js", "utf8");
  const web = readFileSync("admin/src/dashboard/DashboardPage.tsx", "utf8");
  const model = readFileSync("admin/src/dashboard/dashboard.model.ts", "utf8");
  const android = readFileSync("apps/android/app/src/main/java/br/com/rpdoces/admin/data/dashboard/DashboardRepository.kt", "utf8");
  assert.match(api, /p\\.criado_em AS data_venda/);
  assert.match(web, /sameLocalDay\\(parseDashboardDate\\(order\\.criado_em\\), selectedDate\\)/);
  assert.match(model, /sameLocalDay\\(parseDashboardDate\\(order\\.criado_em\\), now\\)/);
  assert.match(android, /sameDay\\(order\\.createdAt, today, zoneId\\)/);
  assert.doesNotMatch(api, /COALESCE\\(pp\\.pago_em, pp\\.atualizado_em\\) AS recebido_em/);
});

test("pedidos de diagnóstico não contaminam métricas nem resumo", () => {
  const metrics = readFileSync("functions/api/admin/dashboard/metrics.js", "utf8");
  const summary = readFileSync("functions/api/admin/dashboard/summary.js", "utf8");
  assert.match(metrics, /diagnostic-order:%/);
  assert.match(summary, /diagnostic-order:%/);
});
''',
    encoding="utf-8",
)

Path("tests/diagnostic-order.test.mjs").write_text(
    '''import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("pedido de teste usa identidade permanente e começa pendente", () => {
  const source = readFileSync("functions/api/admin/orders/index.js", "utf8");
  assert.match(source, /body\\?\\.pedido_teste === true/);
  assert.match(source, /diagnostic-order:/);
  assert.match(source, /Apenas o OWNER pode criar pedido de teste/);
  assert.match(source, /diagnosticOrder\\s*\\?\\s*"PENDENTE"/);
});

test("diagnóstico Pix real continua versionado no backend", () => {
  const pix = readFileSync("functions/api/admin/health/pix-real.js", "utf8");
  const refund = readFileSync("functions/api/admin/health/pix-real-refund.js", "utf8");
  const ui = readFileSync("admin/src/store/StoreDiagnostics.tsx", "utf8");
  assert.match(pix, /MP_DIAGNOSTIC_ACCESS_TOKEN/);
  assert.match(refund, /MP_DIAGNOSTIC_ACCESS_TOKEN/);
  assert.match(ui, /Gerar Pix de R\\$ 0,10/);
});
''',
    encoding="utf-8",
)
