import fs from "node:fs";

function replaceOnce(path, before, after) {
  const source = fs.readFileSync(path, "utf8");
  const count = source.split(before).length - 1;
  if (count !== 1) {
    throw new Error(`${path}: esperava 1 ocorrência, encontrei ${count}`);
  }
  fs.writeFileSync(path, source.replace(before, after));
}

// Android: reabertura de comanda paga preservando financeiro/estoque.
const ordersScreen = "apps/android/app/src/main/java/br/com/rpdoces/admin/ui/orders/OrdersScreen.kt";
replaceOnce(
  ordersScreen,
`    val commandClosed = order.commandStatus.equals("ENCERRADA", true)
    val canceledOrder = order.orderStatus.equals("CANCELADO", true) || order.paymentStatus.equals("CANCELADO", true)
    val canReopen = commandClosed && canceledOrder
    val hasChanges = statusDirty || paymentDirty`,
`    val commandClosed = order.commandStatus.equals("ENCERRADA", true)
    val canceledOrder = order.orderStatus.equals("CANCELADO", true) || order.paymentStatus.equals("CANCELADO", true)
    val hasConfirmedPayment = order.paidCents > 0 || effectiveFinancialStatus(order) in setOf("PAGO", "PARCIAL")
    val canReopenPaid = commandClosed && hasConfirmedPayment
    val canReopenCanceled = commandClosed && canceledOrder && !hasConfirmedPayment
    val canReopen = canReopenPaid || canReopenCanceled
    val hasChanges = statusDirty || paymentDirty`
);
replaceOnce(
  ordersScreen,
`                                    canReopen -> {
                                        Text(
                                            "Esta comanda está cancelada e encerrada. Reabra a comanda para voltar a editar status e pagamento.",
                                            color = web.muted,
                                            fontSize = 11.5.sp,
                                            lineHeight = 17.sp
                                        )
                                    }`,
`                                    canReopen -> {
                                        Text(
                                            if (canReopenPaid) {
                                                "Esta comanda está encerrada e possui ${money(order.paidCents)} pagos. Ao reabrir, pagamentos e baixas de estoque serão preservados."
                                            } else {
                                                "Esta comanda está cancelada e encerrada. Reabra a comanda para voltar a editar status e pagamento."
                                            },
                                            color = web.muted,
                                            fontSize = 11.5.sp,
                                            lineHeight = 17.sp
                                        )
                                    }`
);
replaceOnce(
  ordersScreen,
`                                        runCatching { repository.updatePayment(order.id, "PENDENTE") }
                                            .onSuccess {`,
`                                        runCatching {
                                            if (canReopenPaid) repository.reopenPaidCommand(order.id)
                                            else repository.updatePayment(order.id, "PENDENTE")
                                        }.onSuccess {`
);

// Android: barramento de navegação para alertas do Dashboard.
const navigationBus = `package br.com.rpdoces.admin.ui.navigation

import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.receiveAsFlow

sealed interface AppNavigationRequest {
    data class OpenProducts(val productIds: Set<Int>) : AppNavigationRequest
}

object AppNavigationBus {
    private val channel = Channel<AppNavigationRequest>(Channel.BUFFERED)
    val requests = channel.receiveAsFlow()

    fun openProducts(productIds: Collection<Int>) {
        val ids = productIds.filter { it > 0 }.toSet()
        if (ids.isEmpty()) return
        channel.trySend(AppNavigationRequest.OpenProducts(ids))
    }
}
`;
fs.mkdirSync("apps/android/app/src/main/java/br/com/rpdoces/admin/ui/navigation", { recursive: true });
fs.writeFileSync("apps/android/app/src/main/java/br/com/rpdoces/admin/ui/navigation/AppNavigationBus.kt", navigationBus);

const rpApp = "apps/android/app/src/main/java/br/com/rpdoces/admin/ui/RPApp.kt";
replaceOnce(
  rpApp,
`import br.com.rpdoces.admin.ui.dashboard.DashboardScreen
import br.com.rpdoces.admin.ui.orders.OrdersScreen`,
`import br.com.rpdoces.admin.ui.dashboard.DashboardScreen
import br.com.rpdoces.admin.ui.navigation.AppNavigationBus
import br.com.rpdoces.admin.ui.navigation.AppNavigationRequest
import br.com.rpdoces.admin.ui.orders.OrdersScreen`
);
replaceOnce(
  rpApp,
`import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive`,
`import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.isActive`
);
replaceOnce(
  rpApp,
`    var selected by rememberSaveable { mutableStateOf(MainTab.Dashboard) }
    var profileOpen by rememberSaveable { mutableStateOf(false) }`,
`    var selected by rememberSaveable { mutableStateOf(MainTab.Dashboard) }
    var productFocusIds by remember { mutableStateOf<Set<Int>>(emptySet()) }
    var profileOpen by rememberSaveable { mutableStateOf(false) }`
);
replaceOnce(
  rpApp,
`    LaunchedEffect(visibleTabs, selected) {
        if (selected !in visibleTabs) {
            selected = visibleTabs.firstOrNull() ?: MainTab.Dashboard
            profileOpen = false
            notificationOpen = false
        }
    }

    val permissionLauncher`,
`    LaunchedEffect(visibleTabs, selected) {
        if (selected !in visibleTabs) {
            selected = visibleTabs.firstOrNull() ?: MainTab.Dashboard
            profileOpen = false
            notificationOpen = false
        }
    }

    LaunchedEffect(Unit) {
        AppNavigationBus.requests.collect { request ->
            when (request) {
                is AppNavigationRequest.OpenProducts -> {
                    productFocusIds = request.productIds
                    openTab(MainTab.Produtos)
                }
            }
        }
    }

    val permissionLauncher`
);
replaceOnce(
  rpApp,
`                                MainTab.Produtos -> ProductsScreen(
                                    repository = productsRepository,
                                    modifier = Modifier.fillMaxSize()
                                )`,
`                                MainTab.Produtos -> ProductsScreen(
                                    repository = productsRepository,
                                    focusProductIds = productFocusIds,
                                    onFocusConsumed = { productFocusIds = emptySet() },
                                    modifier = Modifier.fillMaxSize()
                                )`
);

const dashboardPanels = "apps/android/app/src/main/java/br/com/rpdoces/admin/ui/dashboard/DashboardPanels.kt";
replaceOnce(
  dashboardPanels,
`import br.com.rpdoces.admin.data.dashboard.dashboardParseInstant
import br.com.rpdoces.admin.ui.theme.LocalRPWebColors`,
`import br.com.rpdoces.admin.data.dashboard.dashboardParseInstant
import br.com.rpdoces.admin.ui.navigation.AppNavigationBus
import br.com.rpdoces.admin.ui.theme.LocalRPWebColors`
);
replaceOnce(
  dashboardPanels,
`@Composable
internal fun AttentionPanelNative(`,
`private data class AttentionEntry(
    val text: String,
    val productIds: Set<Int>? = null
)

@Composable
internal fun AttentionPanelNative(`
);
replaceOnce(
  dashboardPanels,
`    val soldOut = snapshot.products.filter { it.ativo && availableStock(it) <= 0 }
    val attention = buildList {
        if (receivables.isNotEmpty()) {
            add("${receivables.size} cliente${if (receivables.size == 1) "" else "s"} com saldo pendente (${moneyPanel(receivableTotal)} no total)")
        }
        if (soldOut.isNotEmpty()) {
            add("${soldOut.size} produto${if (soldOut.size == 1) " esgotado" else "s esgotados"}: ${soldOut.take(2).joinToString(", ") { it.nome }}")
        }
        if (snapshot.waitingPreparationCount > 0) {
            add("${snapshot.waitingPreparationCount} pedido${if (snapshot.waitingPreparationCount == 1) " pago aguardando" else "s pagos aguardando"} início do preparo")
        }
        if (isEmpty() && snapshot.lowStockCount > 0) {
            add("${snapshot.lowStockCount} produto${if (snapshot.lowStockCount == 1) "" else "s"} com estoque baixo")
        }
    }`,
`    val soldOut = snapshot.products.filter { it.ativo && availableStock(it) <= 0 }
    val lowStock = snapshot.products.filter {
        val available = availableStock(it)
        it.ativo && available in 1..2
    }
    val attention = buildList {
        if (receivables.isNotEmpty()) {
            add(AttentionEntry("${receivables.size} cliente${if (receivables.size == 1) "" else "s"} com saldo pendente (${moneyPanel(receivableTotal)} no total)"))
        }
        if (soldOut.isNotEmpty()) {
            add(AttentionEntry(
                "${soldOut.size} produto${if (soldOut.size == 1) " esgotado" else "s esgotados"}: ${soldOut.take(2).joinToString(", ") { it.nome }}",
                soldOut.map { it.id }.toSet()
            ))
        }
        if (snapshot.waitingPreparationCount > 0) {
            add(AttentionEntry("${snapshot.waitingPreparationCount} pedido${if (snapshot.waitingPreparationCount == 1) " pago aguardando" else "s pagos aguardando"} início do preparo"))
        }
        if (lowStock.isNotEmpty()) {
            add(AttentionEntry(
                "${lowStock.size} produto${if (lowStock.size == 1) "" else "s"} com estoque baixo",
                lowStock.map { it.id }.toSet()
            ))
        }
    }`
);
replaceOnce(
  dashboardPanels,
`                    attention.forEach { item ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .background(web.orangeSoft, RoundedCornerShape(10.dp))
                                .padding(horizontal = 12.dp, vertical = 10.dp),
                            horizontalArrangement = Arrangement.spacedBy(9.dp),
                            verticalAlignment = Alignment.Top
                        ) {
                            Box(
                                modifier = Modifier
                                    .padding(top = 5.dp)
                                    .size(6.dp)
                                    .background(web.tagOrangeText, RoundedCornerShape(99.dp))
                            )
                            Text(item, modifier = Modifier.weight(1f), color = web.text, fontSize = 12.5.sp, lineHeight = 17.sp)
                        }
                    }`,
`                    attention.forEach { item ->
                        val rowModifier = Modifier
                            .fillMaxWidth()
                            .background(web.orangeSoft, RoundedCornerShape(10.dp))
                            .let { base ->
                                if (item.productIds != null) {
                                    base.clickable { AppNavigationBus.openProducts(item.productIds) }
                                } else base
                            }
                            .padding(horizontal = 12.dp, vertical = 10.dp)
                        Row(
                            modifier = rowModifier,
                            horizontalArrangement = Arrangement.spacedBy(9.dp),
                            verticalAlignment = Alignment.Top
                        ) {
                            Box(
                                modifier = Modifier
                                    .padding(top = 5.dp)
                                    .size(6.dp)
                                    .background(web.tagOrangeText, RoundedCornerShape(99.dp))
                            )
                            Text(item.text, modifier = Modifier.weight(1f), color = web.text, fontSize = 12.5.sp, lineHeight = 17.sp)
                        }
                    }`
);

const productsScreen = "apps/android/app/src/main/java/br/com/rpdoces/admin/ui/products/ProductsScreen.kt";
replaceOnce(
  productsScreen,
`import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items`,
`import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.grid.rememberLazyGridState`
);
replaceOnce(
  productsScreen,
`import java.util.Locale
import kotlinx.coroutines.launch`,
`import java.util.Locale
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch`
);
replaceOnce(
  productsScreen,
`fun ProductsScreen(
    repository: ProductsRepository,
    modifier: Modifier = Modifier
) {`,
`fun ProductsScreen(
    repository: ProductsRepository,
    focusProductIds: Set<Int> = emptySet(),
    onFocusConsumed: () -> Unit = {},
    modifier: Modifier = Modifier
) {`
);
replaceOnce(
  productsScreen,
`    var categoriesOpen by remember { mutableStateOf(false) }
    var pendingAction by remember { mutableStateOf<ProductPendingAction?>(null) }

    suspend fun reload()`,
`    var categoriesOpen by remember { mutableStateOf(false) }
    var pendingAction by remember { mutableStateOf<ProductPendingAction?>(null) }
    var highlightedIds by remember { mutableStateOf<Set<Int>>(emptySet()) }
    val gridState = rememberLazyGridState()

    suspend fun reload()`
);
replaceOnce(
  productsScreen,
`    LaunchedEffect(Unit) { reload() }

    val normalizedQuery`,
`    LaunchedEffect(Unit) { reload() }

    LaunchedEffect(focusProductIds, products) {
        if (focusProductIds.isEmpty() || products.isEmpty()) return@LaunchedEffect
        val ids = focusProductIds.filter { id -> products.any { it.id == id } }.toSet()
        if (ids.isEmpty()) {
            onFocusConsumed()
            return@LaunchedEffect
        }
        query = ""
        filter = ProductFilter.ALL
        highlightedIds = ids
        onFocusConsumed()
        val firstIndex = products.indexOfFirst { it.id in ids }
        if (firstIndex >= 0) gridState.animateScrollToItem(firstIndex)
        delay(4_500)
        highlightedIds = emptySet()
    }

    val normalizedQuery`
);
replaceOnce(
  productsScreen,
`            LazyVerticalGrid(
                columns = GridCells.Fixed(2),
                modifier = Modifier.fillMaxSize(),`,
`            LazyVerticalGrid(
                columns = GridCells.Fixed(2),
                state = gridState,
                modifier = Modifier.fillMaxSize(),`
);
replaceOnce(
  productsScreen,
`                    ProductCard(
                        product = product,
                        busy = busyId == product.id,`,
`                    ProductCard(
                        product = product,
                        highlighted = product.id in highlightedIds,
                        busy = busyId == product.id,`
);
replaceOnce(
  productsScreen,
`private fun ProductCard(
    product: Product,
    busy: Boolean,`,
`private fun ProductCard(
    product: Product,
    highlighted: Boolean,
    busy: Boolean,`
);
replaceOnce(
  productsScreen,
`        shape = RoundedCornerShape(12.dp),
        color = web.surface,
        border = BorderStroke(1.dp, web.border)`,
`        shape = RoundedCornerShape(12.dp),
        color = if (highlighted) web.accentSoft else web.surface,
        border = BorderStroke(if (highlighted) 2.dp else 1.dp, if (highlighted) web.accent else web.border)`
);

// Web: botão de reabertura no drawer de pedidos.
const ordersPage = "admin/src/orders/OrdersPage.tsx";
replaceOnce(
  ordersPage,
`  deleteOrderItem,
  listOrders,
  updateManualPayment,`,
`  deleteOrderItem,
  listOrders,
  reopenPaidCommand,
  updateManualPayment,`
);
replaceOnce(
  ordersPage,
`  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);`,
`  const [savingEdit, setSavingEdit] = useState(false);
  const [reopeningCommand, setReopeningCommand] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);`
);
replaceOnce(
  ordersPage,
`  const paidCents = financial?.valor_pago_centavos ?? (selectedPayment?.paid ? Number(selected?.valor_total_centavos || 0) : 0);
  const pendingCents = financial?.saldo_centavos ?? (selectedPayment?.paid ? 0 : Number(selected?.valor_total_centavos || 0));`,
`  const paidCents = financial?.valor_pago_centavos ?? (selectedPayment?.paid ? Number(selected?.valor_total_centavos || 0) : 0);
  const pendingCents = financial?.saldo_centavos ?? (selectedPayment?.paid ? 0 : Number(selected?.valor_total_centavos || 0));
  const selectedCommandClosed = String(selected?.status_comanda || "ABERTA").toUpperCase() === "ENCERRADA";
  const selectedCanceled = String(selected?.status_pedido || "").toUpperCase() === "CANCELADO" ||
    String(selected?.status_pagamento || "").toUpperCase() === "CANCELADO";
  const canReopenCommand = Boolean(selected && selectedCommandClosed && (paidCents > 0 || (selectedIsManual && selectedCanceled)));`
);
replaceOnce(
  ordersPage,
`  async function confirmDeleteItem() {`,
`  async function reopenSelectedCommand() {
    if (!selected || reopeningCommand) return;
    setReopeningCommand(true);
    setEditError(null);
    try {
      if (paidCents > 0) {
        await reopenPaidCommand(selected.id);
      } else {
        await updateManualPayment(selected.id, "PENDENTE");
      }
      await reload(selected.id);
      setFinancial(null);
      setEditing(false);
    } catch (err) {
      setEditError(err instanceof ApiClientError ? err.message : "Não foi possível reabrir a comanda.");
    } finally {
      setReopeningCommand(false);
    }
  }

  async function confirmDeleteItem() {`
);
replaceOnce(
  ordersPage,
`                  ) : (
                    <div className={styles["drawer-actions"]}>
                      <div className={styles["secondary-actions"]} style={{ gridTemplateColumns: "1fr" }}>
                        <button
                          className={styles["secondary-btn"]}
                          type="button"
                          onClick={startEditing}
                        >
                          <Icon name="edit" className={styles["btn-ico"]}/>Editar pedido
                        </button>
                      </div>
                    </div>
                  )}`,
`                  ) : (
                    <div className={styles["drawer-actions"]}>
                      {editError ? (
                        <div className={styles.note} role="alert" style={{ color: "var(--pink-strong)" }}>
                          {editError}
                        </div>
                      ) : null}
                      <div className={styles["secondary-actions"]} style={{ gridTemplateColumns: "1fr" }}>
                        {canReopenCommand ? (
                          <button
                            className={styles["primary-btn"]}
                            type="button"
                            disabled={reopeningCommand}
                            onClick={() => void reopenSelectedCommand()}
                          >
                            {reopeningCommand ? "Reabrindo..." : "Reabrir comanda"}
                          </button>
                        ) : (
                          <button
                            className={styles["secondary-btn"]}
                            type="button"
                            onClick={startEditing}
                          >
                            <Icon name="edit" className={styles["btn-ico"]}/>Editar pedido
                          </button>
                        )}
                      </div>
                    </div>
                  )}`
);

console.log("Patch aplicado com sucesso.");
