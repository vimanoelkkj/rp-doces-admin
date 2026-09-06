from pathlib import Path


def replace_once(path: str, before: str, after: str) -> None:
    file = Path(path)
    source = file.read_text(encoding="utf-8")
    count = source.count(before)
    if count != 1:
        raise RuntimeError(f"{path}: esperava 1 ocorrência, encontrei {count}")
    file.write_text(source.replace(before, after), encoding="utf-8")


# Android: reabertura de comanda paga preservando financeiro/estoque.
orders_screen = "apps/android/app/src/main/java/br/com/rpdoces/admin/ui/orders/OrdersScreen.kt"
replace_once(
    orders_screen,
    '''    val commandClosed = order.commandStatus.equals("ENCERRADA", true)
    val canceledOrder = order.orderStatus.equals("CANCELADO", true) || order.paymentStatus.equals("CANCELADO", true)
    val canReopen = commandClosed && canceledOrder
    val hasChanges = statusDirty || paymentDirty''',
    '''    val commandClosed = order.commandStatus.equals("ENCERRADA", true)
    val canceledOrder = order.orderStatus.equals("CANCELADO", true) || order.paymentStatus.equals("CANCELADO", true)
    val hasConfirmedPayment = order.paidCents > 0 || effectiveFinancialStatus(order) in setOf("PAGO", "PARCIAL")
    val canReopenPaid = commandClosed && hasConfirmedPayment
    val canReopenCanceled = commandClosed && canceledOrder && !hasConfirmedPayment
    val canReopen = canReopenPaid || canReopenCanceled
    val hasChanges = statusDirty || paymentDirty'''
)
replace_once(
    orders_screen,
    '''                                    canReopen -> {
                                        Text(
                                            "Esta comanda está cancelada e encerrada. Reabra a comanda para voltar a editar status e pagamento.",
                                            color = web.muted,
                                            fontSize = 11.5.sp,
                                            lineHeight = 17.sp
                                        )
                                    }''',
    '''                                    canReopen -> {
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
                                    }'''
)
replace_once(
    orders_screen,
    '''                                        runCatching { repository.updatePayment(order.id, "PENDENTE") }
                                            .onSuccess {''',
    '''                                        runCatching {
                                            if (canReopenPaid) repository.reopenPaidCommand(order.id)
                                            else repository.updatePayment(order.id, "PENDENTE")
                                        }.onSuccess {'''
)

# Android: barramento simples para navegar de alertas até Produtos.
nav_dir = Path("apps/android/app/src/main/java/br/com/rpdoces/admin/ui/navigation")
nav_dir.mkdir(parents=True, exist_ok=True)
(nav_dir / "AppNavigationBus.kt").write_text('''package br.com.rpdoces.admin.ui.navigation

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
''', encoding="utf-8")

rp_app = "apps/android/app/src/main/java/br/com/rpdoces/admin/ui/RPApp.kt"
replace_once(
    rp_app,
    '''import br.com.rpdoces.admin.ui.dashboard.DashboardScreen
import br.com.rpdoces.admin.ui.orders.OrdersScreen''',
    '''import br.com.rpdoces.admin.ui.dashboard.DashboardScreen
import br.com.rpdoces.admin.ui.navigation.AppNavigationBus
import br.com.rpdoces.admin.ui.navigation.AppNavigationRequest
import br.com.rpdoces.admin.ui.orders.OrdersScreen'''
)
replace_once(
    rp_app,
    '''import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive''',
    '''import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.isActive'''
)
replace_once(
    rp_app,
    '''    var selected by rememberSaveable { mutableStateOf(MainTab.Dashboard) }
    var profileOpen by rememberSaveable { mutableStateOf(false) }''',
    '''    var selected by rememberSaveable { mutableStateOf(MainTab.Dashboard) }
    var productFocusIds by remember { mutableStateOf<Set<Int>>(emptySet()) }
    var profileOpen by rememberSaveable { mutableStateOf(false) }'''
)
replace_once(
    rp_app,
    '''    LaunchedEffect(visibleTabs, selected) {
        if (selected !in visibleTabs) {
            selected = visibleTabs.firstOrNull() ?: MainTab.Dashboard
            profileOpen = false
            notificationOpen = false
        }
    }

    val permissionLauncher''',
    '''    LaunchedEffect(visibleTabs, selected) {
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

    val permissionLauncher'''
)
replace_once(
    rp_app,
    '''                                MainTab.Produtos -> ProductsScreen(
                                    repository = productsRepository,
                                    modifier = Modifier.fillMaxSize()
                                )''',
    '''                                MainTab.Produtos -> ProductsScreen(
                                    repository = productsRepository,
                                    focusProductIds = productFocusIds,
                                    onFocusConsumed = { productFocusIds = emptySet() },
                                    modifier = Modifier.fillMaxSize()
                                )'''
)

# Android: alertas de estoque recebem IDs e tornam-se clicáveis.
dashboard_panels = "apps/android/app/src/main/java/br/com/rpdoces/admin/ui/dashboard/DashboardPanels.kt"
replace_once(
    dashboard_panels,
    '''import br.com.rpdoces.admin.data.dashboard.dashboardParseInstant
import br.com.rpdoces.admin.ui.theme.LocalRPWebColors''',
    '''import br.com.rpdoces.admin.data.dashboard.dashboardParseInstant
import br.com.rpdoces.admin.ui.navigation.AppNavigationBus
import br.com.rpdoces.admin.ui.theme.LocalRPWebColors'''
)
replace_once(
    dashboard_panels,
    '''@Composable
internal fun AttentionPanelNative(''',
    '''private data class AttentionEntry(
    val text: String,
    val productIds: Set<Int>? = null
)

@Composable
internal fun AttentionPanelNative('''
)
replace_once(
    dashboard_panels,
    '''    val soldOut = snapshot.products.filter { it.ativo && availableStock(it) <= 0 }
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
    }''',
    '''    val soldOut = snapshot.products.filter { it.ativo && availableStock(it) <= 0 }
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
    }'''
)
replace_once(
    dashboard_panels,
    '''                    attention.forEach { item ->
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
                    }''',
    '''                    attention.forEach { item ->
                        val rowModifier = Modifier
                            .fillMaxWidth()
                            .background(web.orangeSoft, RoundedCornerShape(10.dp))
                            .let { base ->
                                if (item.productIds != null) base.clickable { AppNavigationBus.openProducts(item.productIds) }
                                else base
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
                    }'''
)

# Android: Produtos rola até o primeiro afetado e realça todos os IDs recebidos.
products_screen = "apps/android/app/src/main/java/br/com/rpdoces/admin/ui/products/ProductsScreen.kt"
replace_once(
    products_screen,
    '''import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items''',
    '''import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.grid.rememberLazyGridState'''
)
replace_once(
    products_screen,
    '''import java.util.Locale
import kotlinx.coroutines.launch''',
    '''import java.util.Locale
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch'''
)
replace_once(
    products_screen,
    '''fun ProductsScreen(
    repository: ProductsRepository,
    modifier: Modifier = Modifier
) {''',
    '''fun ProductsScreen(
    repository: ProductsRepository,
    focusProductIds: Set<Int> = emptySet(),
    onFocusConsumed: () -> Unit = {},
    modifier: Modifier = Modifier
) {'''
)
replace_once(
    products_screen,
    '''    var categoriesOpen by remember { mutableStateOf(false) }
    var pendingAction by remember { mutableStateOf<ProductPendingAction?>(null) }

    suspend fun reload()''',
    '''    var categoriesOpen by remember { mutableStateOf(false) }
    var pendingAction by remember { mutableStateOf<ProductPendingAction?>(null) }
    var highlightedIds by remember { mutableStateOf<Set<Int>>(emptySet()) }
    val gridState = rememberLazyGridState()

    suspend fun reload()'''
)
replace_once(
    products_screen,
    '''    LaunchedEffect(Unit) { reload() }

    val normalizedQuery''',
    '''    LaunchedEffect(Unit) { reload() }

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

    val normalizedQuery'''
)
replace_once(
    products_screen,
    '''            LazyVerticalGrid(
                columns = GridCells.Fixed(2),
                modifier = Modifier.fillMaxSize(),''',
    '''            LazyVerticalGrid(
                columns = GridCells.Fixed(2),
                state = gridState,
                modifier = Modifier.fillMaxSize(),'''
)
replace_once(
    products_screen,
    '''                    ProductCard(
                        product = product,
                        busy = busyId == product.id,''',
    '''                    ProductCard(
                        product = product,
                        highlighted = product.id in highlightedIds,
                        busy = busyId == product.id,'''
)
replace_once(
    products_screen,
    '''private fun ProductCard(
    product: Product,
    busy: Boolean,''',
    '''private fun ProductCard(
    product: Product,
    highlighted: Boolean,
    busy: Boolean,'''
)
replace_once(
    products_screen,
    '''        shape = RoundedCornerShape(12.dp),
        color = web.surface,
        border = BorderStroke(1.dp, web.border)''',
    '''        shape = RoundedCornerShape(12.dp),
        color = if (highlighted) web.accentSoft else web.surface,
        border = BorderStroke(if (highlighted) 2.dp else 1.dp, if (highlighted) web.accent else web.border)'''
)

# Web: botão de reabertura no drawer de Pedidos.
orders_page = "admin/src/orders/OrdersPage.tsx"
replace_once(
    orders_page,
    '''  deleteOrderItem,
  listOrders,
  updateManualPayment,''',
    '''  deleteOrderItem,
  listOrders,
  reopenPaidCommand,
  updateManualPayment,'''
)
replace_once(
    orders_page,
    '''  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);''',
    '''  const [savingEdit, setSavingEdit] = useState(false);
  const [reopeningCommand, setReopeningCommand] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);'''
)
replace_once(
    orders_page,
    '''  const paidCents = financial?.valor_pago_centavos ?? (selectedPayment?.paid ? Number(selected?.valor_total_centavos || 0) : 0);
  const pendingCents = financial?.saldo_centavos ?? (selectedPayment?.paid ? 0 : Number(selected?.valor_total_centavos || 0));''',
    '''  const paidCents = financial?.valor_pago_centavos ?? (selectedPayment?.paid ? Number(selected?.valor_total_centavos || 0) : 0);
  const pendingCents = financial?.saldo_centavos ?? (selectedPayment?.paid ? 0 : Number(selected?.valor_total_centavos || 0));
  const selectedCommandClosed = String(selected?.status_comanda || "ABERTA").toUpperCase() === "ENCERRADA";
  const selectedCanceled = String(selected?.status_pedido || "").toUpperCase() === "CANCELADO" ||
    String(selected?.status_pagamento || "").toUpperCase() === "CANCELADO";
  const canReopenCommand = Boolean(selected && selectedCommandClosed && (paidCents > 0 || (selectedIsManual && selectedCanceled)));'''
)
replace_once(
    orders_page,
    '''  async function confirmDeleteItem() {''',
    '''  async function reopenSelectedCommand() {
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

  async function confirmDeleteItem() {'''
)
replace_once(
    orders_page,
    '''                  ) : (
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
                  )}''',
    '''                  ) : (
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
                  )}'''
)

# Web: estoque baixo aparece junto dos demais alertas, não somente sozinho.
dashboard_page = "admin/src/dashboard/DashboardPage.tsx"
replace_once(
    dashboard_page,
    '''    if (!messages.length && summary.lowStockCount) {''',
    '''    if (summary.lowStockCount) {'''
)

print("Patch aplicado com sucesso.")
