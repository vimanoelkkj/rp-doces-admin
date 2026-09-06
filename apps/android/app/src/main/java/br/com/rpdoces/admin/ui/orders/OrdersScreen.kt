package br.com.rpdoces.admin.ui.orders

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.KeyboardArrowRight
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import br.com.rpdoces.admin.data.dashboard.dashboardParseInstant
import br.com.rpdoces.admin.data.orders.Order
import br.com.rpdoces.admin.data.orders.OrderItem
import br.com.rpdoces.admin.data.orders.OrdersRepository
import br.com.rpdoces.admin.data.products.ProductsRepository
import br.com.rpdoces.admin.ui.components.MotionChevron
import br.com.rpdoces.admin.ui.components.MotionDropdownMenu
import br.com.rpdoces.admin.ui.components.WebSelectorOption
import br.com.rpdoces.admin.ui.theme.LocalRPWebColors
import java.text.NumberFormat
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

private enum class OrderFilter(val label: String) {
    ALL("Todos"), TODAY("Hoje"), PRODUCTION("Em produção"), READY("Prontos"), DELIVERED("Entregues")
}

private val orderStatusOptions = listOf(
    "NOVO" to "Pendente",
    "PREPARANDO" to "Em produção",
    "PRONTO" to "Pronto",
    "ENTREGUE" to "Entregue"
)

private val paymentOptions = listOf(
    "PENDENTE" to "Pendente",
    "PAGO" to "Pago"
)

@Composable
fun OrdersScreen(
    repository: OrdersRepository,
    productsRepository: ProductsRepository,
    modifier: Modifier = Modifier
) {
    val web = LocalRPWebColors.current
    val scope = rememberCoroutineScope()
    var orders by remember { mutableStateOf<List<Order>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var query by remember { mutableStateOf("") }
    var filter by remember { mutableStateOf(OrderFilter.ALL) }
    var filterOpen by remember { mutableStateOf(false) }
    var selected by remember { mutableStateOf<Order?>(null) }
    var manualOrderOpen by remember { mutableStateOf(false) }

    suspend fun reload(silent: Boolean = false) {
        if (!silent) loading = orders.isEmpty()
        try {
            orders = repository.list()
            error = null
            selected = selected?.let { old -> orders.firstOrNull { it.id == old.id } ?: old }
        } catch (t: Throwable) {
            if (!silent) error = t.message ?: "Não foi possível carregar os pedidos."
        } finally {
            loading = false
        }
    }

    LaunchedEffect(Unit) {
        reload()
        while (isActive) {
            delay(10_000)
            reload(silent = true)
        }
    }

    val normalized = query.trim().lowercase(Locale("pt", "BR"))
    val visible = orders.filter { order ->
        val items = order.itens.joinToString(" ") { it.productName.orEmpty() }
        val search = "${order.id} ${order.customerName.orEmpty()} $items".lowercase(Locale("pt", "BR"))
        val matchesQuery = normalized.isBlank() || normalized in search
        val status = order.orderStatus.orEmpty().uppercase()
        val matchesFilter = when (filter) {
            OrderFilter.ALL -> true
            OrderFilter.TODAY -> isToday(order.createdAt)
            OrderFilter.PRODUCTION -> status == "PREPARANDO"
            OrderFilter.READY -> status == "PRONTO"
            OrderFilter.DELIVERED -> status == "ENTREGUE"
        }
        matchesQuery && matchesFilter
    }

    val counts = remember(orders) {
        mapOf(
            OrderFilter.ALL to orders.size,
            OrderFilter.TODAY to orders.count { isToday(it.createdAt) },
            OrderFilter.PRODUCTION to orders.count { it.orderStatus.equals("PREPARANDO", true) },
            OrderFilter.READY to orders.count { it.orderStatus.equals("PRONTO", true) },
            OrderFilter.DELIVERED to orders.count { it.orderStatus.equals("ENTREGUE", true) }
        )
    }

    Column(modifier = modifier.fillMaxSize().padding(horizontal = 12.dp)) {
        OrdersSearch(query = query, onQueryChange = { query = it })
        Spacer(Modifier.height(12.dp))

        Surface(
            onClick = { manualOrderOpen = true },
            modifier = Modifier.fillMaxWidth().height(44.dp),
            shape = RoundedCornerShape(10.dp),
            color = web.accent,
            border = BorderStroke(1.dp, web.accentDark)
        ) {
            Box(contentAlignment = Alignment.Center) {
                Text("+ Novo pedido", color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
            }
        }

        Spacer(Modifier.height(14.dp))

        Surface(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(14.dp),
            color = web.surfaceVeilTwo,
            border = BorderStroke(1.dp, web.border)
        ) {
            Column {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    Text("Filtrar pedidos", color = web.muted, fontSize = 11.5.sp, fontWeight = FontWeight.Bold)
                    Box(modifier = Modifier.weight(1f)) {
                        Surface(
                            onClick = { filterOpen = true },
                            modifier = Modifier.fillMaxWidth().height(40.dp),
                            shape = RoundedCornerShape(10.dp),
                            color = web.surface,
                            border = BorderStroke(1.dp, web.borderStrong)
                        ) {
                            Row(
                                modifier = Modifier.fillMaxSize().padding(horizontal = 12.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.SpaceBetween
                            ) {
                                Text("${filter.label} · ${counts[filter] ?: 0}", color = web.text, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                                MotionChevron(expanded = filterOpen, tint = web.muted, modifier = Modifier.size(18.dp))
                            }
                        }
                        MotionDropdownMenu(expanded = filterOpen, onDismissRequest = { filterOpen = false }) {
                            OrderFilter.entries.forEach { item ->
                                WebSelectorOption(
                                    text = "${item.label} · ${counts[item] ?: 0}",
                                    selected = item == filter,
                                    onClick = {
                                        filter = item
                                        filterOpen = false
                                    }
                                )
                            }
                        }
                    }
                }
                HorizontalDivider(color = web.border)

                when {
                    loading && orders.isEmpty() -> Box(modifier = Modifier.fillMaxWidth().height(180.dp), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator(color = web.accent)
                    }
                    error != null && orders.isEmpty() -> Text(
                        error.orEmpty(),
                        color = web.danger,
                        fontSize = 12.sp,
                        modifier = Modifier.padding(18.dp)
                    )
                    visible.isEmpty() -> Text(
                        "Nenhum pedido encontrado.",
                        color = web.muted,
                        fontSize = 12.sp,
                        modifier = Modifier.padding(18.dp)
                    )
                    else -> LazyColumn(contentPadding = PaddingValues(bottom = 18.dp)) {
                        items(visible, key = { it.id }) { order ->
                            OrderMobileRow(order = order, onClick = { selected = order })
                        }
                    }
                }
            }
        }
    }

    if (manualOrderOpen) {
        ManualOrderDialog(
            ordersRepository = repository,
            productsRepository = productsRepository,
            onDismiss = { manualOrderOpen = false },
            onCreated = {
                scope.launch { reload(silent = true) }
            }
        )
    }

    selected?.let { order ->
        OrderDetailDialog(
            order = order,
            repository = repository,
            productsRepository = productsRepository,
            onDismiss = { selected = null },
            onUpdated = {
                scope.launch { reload(silent = true) }
            }
        )
    }
}

@Composable
private fun OrdersSearch(query: String, onQueryChange: (String) -> Unit) {
    val web = LocalRPWebColors.current
    Surface(
        modifier = Modifier.fillMaxWidth().height(44.dp),
        shape = RoundedCornerShape(10.dp),
        color = web.surfaceVeilTwo,
        border = BorderStroke(1.dp, web.borderStrong)
    ) {
        Row(
            modifier = Modifier.fillMaxSize().padding(horizontal = 14.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(Icons.Outlined.Search, contentDescription = null, tint = web.muted, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(10.dp))
            BasicTextField(
                value = query,
                onValueChange = onQueryChange,
                singleLine = true,
                textStyle = MaterialTheme.typography.bodyMedium.copy(color = web.text, fontSize = 12.5.sp),
                modifier = Modifier.weight(1f),
                decorationBox = { inner ->
                    Box {
                        if (query.isBlank()) Text("Buscar pedido, cliente ou comanda", color = web.muted, fontSize = 12.5.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        inner()
                    }
                }
            )
        }
    }
}

@Composable
private fun OrderMobileRow(order: Order, onClick: () -> Unit) {
    val web = LocalRPWebColors.current
    val firstItem = order.itens.firstOrNull()?.productName ?: "Pedido sem itens"
    val extra = (order.itens.size - 1).coerceAtLeast(0)
    val paid = effectiveFinancialStatus(order) == "PAGO"
    val status = statusInfo(order.orderStatus)

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 16.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.Top
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("#${order.id}", color = web.accentDark, fontSize = 12.5.sp, fontWeight = FontWeight.Bold)
                Text(order.customerName ?: "Cliente não informado", color = web.text, fontSize = 12.5.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Text(
                text = if (extra > 0) "$firstItem · +$extra itens" else firstItem,
                color = web.muted,
                fontSize = 11.sp,
                modifier = Modifier.padding(top = 7.dp),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            Text(
                text = "${scheduleLabel(order.createdAt)} · ${deliveryLabel(order.deliveryType)} · Comanda #${order.id} ${commandLabel(order.commandStatus).lowercase()}",
                color = web.muted,
                fontSize = 10.5.sp,
                modifier = Modifier.padding(top = 4.dp),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            StatusTag(label = status.first, tone = status.second, modifier = Modifier.padding(top = 9.dp))
        }

        Column(horizontalAlignment = Alignment.End) {
            Text(money(order.totalCents), color = web.text, fontSize = 12.5.sp, fontWeight = FontWeight.Bold)
            Text(
                if (paid) "✓ Pago" else "Pendente",
                color = if (paid) web.tagGreenText else web.tagOrangeText,
                fontSize = 11.5.sp,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.padding(top = 8.dp)
            )
            Icon(Icons.Outlined.KeyboardArrowRight, contentDescription = null, tint = web.muted, modifier = Modifier.size(18.dp))
        }
    }
    HorizontalDivider(color = web.border)
}

@Composable
private fun StatusTag(label: String, tone: String, modifier: Modifier = Modifier) {
    val web = LocalRPWebColors.current
    val (bg, fg) = when (tone) {
        "green" -> web.greenSoft to web.tagGreenText
        "purple" -> web.purpleSoft to web.purple
        "pink" -> web.accentSoft to web.accentDark
        else -> web.orangeSoft to web.tagOrangeText
    }
    Surface(modifier = modifier, shape = RoundedCornerShape(8.dp), color = bg) {
        Text(label, color = fg, fontSize = 10.5.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(horizontal = 9.dp, vertical = 5.dp))
    }
}

@Composable
private fun OrderDetailDialog(
    order: Order,
    repository: OrdersRepository,
    productsRepository: ProductsRepository,
    onDismiss: () -> Unit,
    onUpdated: () -> Unit
) {
    val web = LocalRPWebColors.current
    val scope = rememberCoroutineScope()
    var tab by remember { mutableStateOf("pedido") }
    var status by remember(order.id) { mutableStateOf(order.orderStatus?.uppercase() ?: "NOVO") }
    var payment by remember(order.id) { mutableStateOf(effectiveFinancialStatus(order)) }
    var statusDirty by remember(order.id) { mutableStateOf(false) }
    var paymentDirty by remember(order.id) { mutableStateOf(false) }
    var statusOpen by remember { mutableStateOf(false) }
    var paymentOpen by remember { mutableStateOf(false) }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var editingItem by remember(order.id) { mutableStateOf<OrderItem?>(null) }
    var deletingItem by remember(order.id) { mutableStateOf<OrderItem?>(null) }
    var deleting by remember { mutableStateOf(false) }
    var deleteError by remember { mutableStateOf<String?>(null) }
    var reallocatingItem by remember(order.id) { mutableStateOf<OrderItem?>(null) }
    var reallocating by remember { mutableStateOf(false) }
    var reallocationError by remember { mutableStateOf<String?>(null) }
    var cancelConfirmOpen by remember(order.id) { mutableStateOf(false) }
    var canceling by remember(order.id) { mutableStateOf(false) }
    var cancelError by remember(order.id) { mutableStateOf<String?>(null) }

    val commandClosed = order.commandStatus.equals("ENCERRADA", true)
    val canceledOrder = order.orderStatus.equals("CANCELADO", true) || order.paymentStatus.equals("CANCELADO", true)
    val hasConfirmedPayment = order.paidCents > 0 || effectiveFinancialStatus(order) in setOf("PAGO", "PARCIAL")
    val canReopenPaid = commandClosed && hasConfirmedPayment
    val canReopenCanceled = commandClosed && canceledOrder && !hasConfirmedPayment
    val canReopen = canReopenPaid || canReopenCanceled
    val hasChanges = statusDirty || paymentDirty

    LaunchedEffect(order.orderStatus, statusDirty) {
        if (!statusDirty) status = order.orderStatus?.uppercase() ?: "NOVO"
    }
    LaunchedEffect(order.financialStatus, order.paymentStatus, paymentDirty) {
        if (!paymentDirty) payment = effectiveFinancialStatus(order)
    }

    Dialog(
        onDismissRequest = {
            if (!saving && !cancelConfirmOpen && editingItem == null && deletingItem == null && reallocatingItem == null) onDismiss()
        },
        properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)
    ) {
        Surface(modifier = Modifier.fillMaxSize(), color = web.surface) {
            Column(modifier = Modifier.fillMaxSize().padding(horizontal = 20.dp, vertical = 26.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text("Pedido #${order.id}", color = web.text, fontSize = 19.sp, fontWeight = FontWeight.Bold)
                        Text(order.customerName ?: "Cliente não informado", color = web.muted, fontSize = 12.sp, modifier = Modifier.padding(top = 3.dp))
                    }
                    Icon(
                        Icons.Outlined.Close,
                        contentDescription = "Fechar",
                        tint = web.muted,
                        modifier = Modifier
                            .size(28.dp)
                            .clickable(
                                enabled = !saving && !cancelConfirmOpen && editingItem == null && deletingItem == null && reallocatingItem == null
                            ) { onDismiss() }
                            .padding(4.dp)
                    )
                }

                Spacer(Modifier.height(18.dp))
                Row(modifier = Modifier.fillMaxWidth()) {
                    DetailTab("Pedido", tab == "pedido", Modifier.weight(1f)) { tab = "pedido" }
                    DetailTab("Comanda", tab == "comanda", Modifier.weight(1f)) { tab = "comanda" }
                }
                HorizontalDivider(color = web.border)

                LazyColumn(
                    modifier = Modifier.weight(1f),
                    contentPadding = PaddingValues(top = 18.dp, bottom = 20.dp),
                    verticalArrangement = Arrangement.spacedBy(16.dp)
                ) {
                    if (tab == "pedido") {
                        item {
                            DetailSection("Resumo") {
                                DetailLine("Data", scheduleLabel(order.createdAt))
                                DetailLine("Entrega", deliveryLabel(order.deliveryType))
                                DetailLine("Pagamento", order.paymentMethod ?: "—")
                                DetailLine("Total", money(order.totalCents), strong = true)
                            }
                        }
                        item {
                            DetailSection("Itens") {
                                order.itens.forEach { item ->
                                    val canEditItem = item.id != null && !commandClosed && !canceledOrder
                                    Row(
                                        modifier = Modifier.fillMaxWidth().padding(vertical = 7.dp),
                                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                                        verticalAlignment = Alignment.CenterVertically
                                    ) {
                                        Column(modifier = Modifier.weight(1f)) {
                                            Text(
                                                "${item.quantidade}× ${item.productName ?: "Produto"}",
                                                color = web.text,
                                                fontSize = 12.sp,
                                                maxLines = 1,
                                                overflow = TextOverflow.Ellipsis
                                            )
                                            Text(
                                                money(item.totalCents),
                                                color = web.muted,
                                                fontSize = 10.5.sp,
                                                modifier = Modifier.padding(top = 2.dp)
                                            )
                                        }
                                        if (canEditItem) {
                                            Surface(
                                                onClick = { editingItem = item },
                                                modifier = Modifier.height(32.dp),
                                                shape = RoundedCornerShape(8.dp),
                                                color = web.accentSoft,
                                                border = BorderStroke(1.dp, web.accent.copy(alpha = .35f))
                                            ) {
                                                Box(
                                                    modifier = Modifier.padding(horizontal = 11.dp),
                                                    contentAlignment = Alignment.Center
                                                ) {
                                                    Text("Trocar", color = web.accentDark, fontSize = 10.5.sp, fontWeight = FontWeight.Bold)
                                                }
                                            }
                                        } else {
                                            Text(money(item.totalCents), color = web.text, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                                        }
                                    }
                                }
                            }
                        }
                        if (!order.note.isNullOrBlank()) {
                            item { DetailSection("Observação") { Text(order.note, color = web.muted, fontSize = 12.sp, lineHeight = 17.sp) } }
                        }
                        item {
                            DetailSection("Editar pedido") {
                                when {
                                    canReopen -> {
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
                                    }
                                    commandClosed -> {
                                        Text(
                                            "Esta comanda já foi encerrada.",
                                            color = web.muted,
                                            fontSize = 11.5.sp
                                        )
                                    }
                                    else -> {
                                        SelectorField(
                                            label = "Status",
                                            selectedKey = status,
                                            value = orderStatusOptions.firstOrNull { it.first == status }?.second ?: status,
                                            expanded = statusOpen,
                                            onExpand = { statusOpen = true },
                                            onDismiss = { statusOpen = false },
                                            options = orderStatusOptions,
                                            onSelect = { selectedStatus ->
                                                status = selectedStatus
                                                statusDirty = selectedStatus != (order.orderStatus?.uppercase() ?: "NOVO")
                                                statusOpen = false
                                            }
                                        )
                                        Spacer(Modifier.height(10.dp))
                                        SelectorField(
                                            label = "Pagamento",
                                            selectedKey = payment,
                                            value = paymentOptions.firstOrNull { it.first == payment }?.second ?: payment,
                                            expanded = paymentOpen,
                                            onExpand = { paymentOpen = true },
                                            onDismiss = { paymentOpen = false },
                                            options = paymentOptions,
                                            onSelect = { selectedPayment ->
                                                payment = selectedPayment
                                                paymentDirty = selectedPayment != effectiveFinancialStatus(order)
                                                paymentOpen = false
                                            }
                                        )
                                    }
                                }
                            }
                        }
                    } else {
                        item {
                            DetailSection("Comanda #${order.id}") {
                                order.itens.forEach { item ->
                                    val comandaEditable = !commandClosed && !canceledOrder
                                    val reallocationCandidates = order.itens.filter { candidate ->
                                        candidate.id != item.id && candidate.id != null && candidate.balanceCents > 0
                                    }
                                    val canReallocateItem = item.id != null &&
                                        item.paidCents > 0 &&
                                        reallocationCandidates.isNotEmpty() &&
                                        comandaEditable
                                    val canDeleteItem = item.id != null &&
                                        order.itens.size > 1 &&
                                        item.paidCents <= 0 &&
                                        item.stockDeductedAt == null &&
                                        comandaEditable

                                    Column(modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
                                        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                            Text("${item.quantidade}× ${item.productName ?: "Produto"}", color = web.text, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                                            Text(financialLabel(item.financialStatus), color = if (item.financialStatus == "PAGO") web.tagGreenText else web.tagOrangeText, fontSize = 10.5.sp, fontWeight = FontWeight.Bold)
                                        }
                                        Text(
                                            when (item.financialStatus?.uppercase()) {
                                                "PAGO" -> "${money(item.paidCents)} pagos"
                                                "PARCIAL" -> "${money(item.paidCents)} pagos · ${money(item.balanceCents)} pendentes"
                                                else -> "${money(item.balanceCents.takeIf { it > 0 } ?: item.totalCents)} pendentes"
                                            },
                                            color = web.muted,
                                            fontSize = 10.5.sp,
                                            modifier = Modifier.padding(top = 3.dp)
                                        )
                                        if (canReallocateItem) {
                                            Surface(
                                                onClick = {
                                                    reallocationError = null
                                                    reallocatingItem = item
                                                },
                                                modifier = Modifier.padding(top = 8.dp).height(30.dp),
                                                shape = RoundedCornerShape(8.dp),
                                                color = web.accentSoft,
                                                border = BorderStroke(1.dp, web.accent.copy(alpha = .35f))
                                            ) {
                                                Box(modifier = Modifier.padding(horizontal = 10.dp), contentAlignment = Alignment.Center) {
                                                    Text("Corrigir item", color = web.accentDark, fontSize = 10.5.sp, fontWeight = FontWeight.Bold)
                                                }
                                            }
                                        } else if (canDeleteItem) {
                                            Surface(
                                                onClick = {
                                                    deleteError = null
                                                    deletingItem = item
                                                },
                                                modifier = Modifier.padding(top = 8.dp).height(30.dp),
                                                shape = RoundedCornerShape(8.dp),
                                                color = web.surface,
                                                border = BorderStroke(1.dp, web.danger.copy(alpha = .35f))
                                            ) {
                                                Box(modifier = Modifier.padding(horizontal = 10.dp), contentAlignment = Alignment.Center) {
                                                    Text("Excluir", color = web.danger, fontSize = 10.5.sp, fontWeight = FontWeight.Bold)
                                                }
                                            }
                                        }
                                    }
                                    HorizontalDivider(color = web.border)
                                }
                                Spacer(Modifier.height(8.dp))
                                DetailLine("Total", money(order.totalCents))
                                DetailLine("Pago", money(order.paidCents))
                                DetailLine("Restante", money(order.balanceCents), strong = true)
                            }
                        }
                    }
                }

                if (error != null) Text(error.orEmpty(), color = web.danger, fontSize = 11.5.sp, modifier = Modifier.padding(bottom = 8.dp))

                if (tab == "pedido") {
                    if (canReopen) {
                        Surface(
                            onClick = {
                                if (!saving) {
                                    saving = true
                                    error = null
                                    scope.launch {
                                        runCatching {
                                            if (canReopenPaid) repository.reopenPaidCommand(order.id)
                                            else repository.updatePayment(order.id, "PENDENTE")
                                        }.onSuccess {
                                                statusDirty = false
                                                paymentDirty = false
                                                onUpdated()
                                                onDismiss()
                                            }
                                            .onFailure { error = it.message ?: "Não foi possível reabrir a comanda." }
                                        saving = false
                                    }
                                }
                            },
                            enabled = !saving,
                            modifier = Modifier.fillMaxWidth().height(44.dp),
                            shape = RoundedCornerShape(10.dp),
                            color = web.accent,
                            border = BorderStroke(1.dp, web.accentDark)
                        ) {
                            Box(contentAlignment = Alignment.Center) {
                                if (saving) CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp, color = Color.White)
                                else Text("Reabrir comanda", color = Color.White, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                            }
                        }
                    } else if (!commandClosed) {
                        Surface(
                            onClick = {
                                if (!saving && hasChanges) {
                                    saving = true
                                    error = null
                                    scope.launch {
                                        runCatching {
                                            if (paymentDirty) repository.updatePayment(order.id, payment)
                                            if (statusDirty) repository.updateStatus(order.id, status)
                                        }.onSuccess {
                                            statusDirty = false
                                            paymentDirty = false
                                            onUpdated()
                                            onDismiss()
                                        }.onFailure { error = it.message ?: "Não foi possível salvar as alterações." }
                                        saving = false
                                    }
                                }
                            },
                            enabled = !saving && hasChanges,
                            modifier = Modifier.fillMaxWidth().height(44.dp),
                            shape = RoundedCornerShape(10.dp),
                            color = if (hasChanges) web.accent else web.surfaceSoft,
                            border = BorderStroke(1.dp, if (hasChanges) web.accentDark else web.borderStrong)
                        ) {
                            Box(contentAlignment = Alignment.Center) {
                                if (saving) CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp, color = Color.White)
                                else Text(
                                    "Salvar alterações",
                                    color = if (hasChanges) Color.White else web.muted,
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.Bold
                                )
                            }
                        }

                        Spacer(Modifier.height(10.dp))
                        Surface(
                            onClick = {
                                cancelError = null
                                cancelConfirmOpen = true
                            },
                            enabled = !saving,
                            modifier = Modifier.fillMaxWidth().height(42.dp),
                            shape = RoundedCornerShape(10.dp),
                            color = web.surface,
                            border = BorderStroke(1.dp, web.danger.copy(alpha = .45f))
                        ) {
                            Box(contentAlignment = Alignment.Center) {
                                Text("Cancelar pedido", color = web.danger, fontSize = 11.5.sp, fontWeight = FontWeight.Bold)
                            }
                        }
                    }
                }
            }
        }
    }

    if (cancelConfirmOpen) {
        CancelOrderConfirmDialog(
            order = order,
            busy = canceling,
            error = cancelError,
            onDismiss = {
                if (!canceling) {
                    cancelConfirmOpen = false
                    cancelError = null
                }
            },
            onConfirm = {
                if (!canceling) {
                    canceling = true
                    cancelError = null
                    scope.launch {
                        runCatching { repository.cancelOrder(order.id) }
                            .onSuccess {
                                cancelConfirmOpen = false
                                onUpdated()
                                onDismiss()
                            }
                            .onFailure { cancelError = it.message ?: "Não foi possível cancelar a comanda." }
                        canceling = false
                    }
                }
            }
        )
    }

    editingItem?.let { item ->
        EditOrderItemDialog(
            order = order,
            item = item,
            ordersRepository = repository,
            productsRepository = productsRepository,
            onDismiss = { editingItem = null },
            onSaved = {
                editingItem = null
                onUpdated()
            }
        )
    }

    deletingItem?.let { item ->
        DeleteOrderItemConfirmDialog(
            item = item,
            busy = deleting,
            error = deleteError,
            onDismiss = {
                if (!deleting) {
                    deletingItem = null
                    deleteError = null
                }
            },
            onConfirm = {
                if (!deleting && item.id != null) {
                    deleting = true
                    deleteError = null
                    scope.launch {
                        runCatching { repository.deleteItem(order.id, item.id) }
                            .onSuccess {
                                deletingItem = null
                                onUpdated()
                            }
                            .onFailure { deleteError = it.message ?: "Não foi possível excluir o item da comanda." }
                        deleting = false
                    }
                }
            }
        )
    }

    reallocatingItem?.let { item ->
        val candidates = order.itens.filter { candidate ->
            candidate.id != item.id && candidate.id != null && candidate.balanceCents > 0
        }
        ReallocateOrderItemDialog(
            item = item,
            candidates = candidates,
            busy = reallocating,
            error = reallocationError,
            onDismiss = {
                if (!reallocating) {
                    reallocatingItem = null
                    reallocationError = null
                }
            },
            onConfirm = { targetItemId ->
                val sourceItemId = item.id
                if (!reallocating && sourceItemId != null) {
                    reallocating = true
                    reallocationError = null
                    scope.launch {
                        runCatching {
                            repository.reallocateItemPayment(order.id, sourceItemId, targetItemId)
                        }.onSuccess {
                            reallocatingItem = null
                            onUpdated()
                        }.onFailure {
                            reallocationError = it.message ?: "Não foi possível corrigir o produto pago da comanda."
                        }
                        reallocating = false
                    }
                }
            }
        )
    }
}

@Composable
private fun CancelOrderConfirmDialog(
    order: Order,
    busy: Boolean,
    error: String?,
    onDismiss: () -> Unit,
    onConfirm: () -> Unit
) {
    val web = LocalRPWebColors.current
    Dialog(
        onDismissRequest = { if (!busy) onDismiss() },
        properties = DialogProperties(usePlatformDefaultWidth = false)
    ) {
        Box(
            modifier = Modifier.fillMaxSize().padding(horizontal = 24.dp),
            contentAlignment = Alignment.Center
        ) {
            Surface(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(16.dp),
                color = web.surface,
                border = BorderStroke(1.dp, web.border)
            ) {
                Column(modifier = Modifier.padding(20.dp)) {
                    Text("CANCELAR PEDIDO", color = web.danger, fontSize = 10.5.sp, fontWeight = FontWeight.Bold)
                    Text(
                        "Cancelar o pedido #${order.id}?",
                        color = web.text,
                        fontSize = 18.sp,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.padding(top = 7.dp)
                    )
                    Text(
                        "Isso encerrará a comanda e liberará os itens ainda reservados. Se houver pagamento confirmado, o cancelamento será bloqueado e será necessário estornar ou reembolsar primeiro.",
                        color = web.muted,
                        fontSize = 11.5.sp,
                        lineHeight = 17.sp,
                        modifier = Modifier.padding(top = 9.dp)
                    )
                    if (!error.isNullOrBlank()) {
                        Text(error, color = web.danger, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 12.dp))
                    }
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(top = 18.dp),
                        horizontalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        Surface(
                            onClick = onDismiss,
                            enabled = !busy,
                            modifier = Modifier.weight(1f).height(42.dp),
                            shape = RoundedCornerShape(9.dp),
                            color = web.surface,
                            border = BorderStroke(1.dp, web.borderStrong)
                        ) {
                            Box(contentAlignment = Alignment.Center) {
                                Text("Voltar", color = web.muted, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                            }
                        }
                        Surface(
                            onClick = onConfirm,
                            enabled = !busy,
                            modifier = Modifier.weight(1f).height(42.dp),
                            shape = RoundedCornerShape(9.dp),
                            color = web.danger,
                            border = BorderStroke(1.dp, web.danger)
                        ) {
                            Box(contentAlignment = Alignment.Center) {
                                if (busy) {
                                    CircularProgressIndicator(modifier = Modifier.size(17.dp), strokeWidth = 2.dp, color = Color.White)
                                } else {
                                    Text("Cancelar pedido", color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun DeleteOrderItemConfirmDialog(
    item: OrderItem,
    busy: Boolean,
    error: String?,
    onDismiss: () -> Unit,
    onConfirm: () -> Unit
) {
    val web = LocalRPWebColors.current
    Dialog(
        onDismissRequest = { if (!busy) onDismiss() },
        properties = DialogProperties(usePlatformDefaultWidth = false)
    ) {
        Box(
            modifier = Modifier.fillMaxSize().padding(horizontal = 24.dp),
            contentAlignment = Alignment.Center
        ) {
            Surface(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(16.dp),
                color = web.surface,
                border = BorderStroke(1.dp, web.border)
            ) {
                Column(modifier = Modifier.padding(20.dp)) {
                    Text("REMOVER DA COMANDA", color = web.danger, fontSize = 10.5.sp, fontWeight = FontWeight.Bold)
                    Text(
                        "Excluir ${item.productName ?: "este produto"}?",
                        color = web.text,
                        fontSize = 18.sp,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.padding(top = 7.dp)
                    )
                    Text(
                        "${item.quantidade}x deste item será removido. A reserva correspondente será liberada e os totais da comanda serão recalculados.",
                        color = web.muted,
                        fontSize = 11.5.sp,
                        lineHeight = 17.sp,
                        modifier = Modifier.padding(top = 9.dp)
                    )
                    if (!error.isNullOrBlank()) {
                        Text(error, color = web.danger, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 12.dp))
                    }
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(top = 18.dp),
                        horizontalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        Surface(
                            onClick = onDismiss,
                            enabled = !busy,
                            modifier = Modifier.weight(1f).height(42.dp),
                            shape = RoundedCornerShape(9.dp),
                            color = web.surface,
                            border = BorderStroke(1.dp, web.borderStrong)
                        ) {
                            Box(contentAlignment = Alignment.Center) {
                                Text("Voltar", color = web.muted, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                            }
                        }
                        Surface(
                            onClick = onConfirm,
                            enabled = !busy,
                            modifier = Modifier.weight(1f).height(42.dp),
                            shape = RoundedCornerShape(9.dp),
                            color = web.danger,
                            border = BorderStroke(1.dp, web.danger)
                        ) {
                            Box(contentAlignment = Alignment.Center) {
                                if (busy) {
                                    CircularProgressIndicator(modifier = Modifier.size(17.dp), strokeWidth = 2.dp, color = Color.White)
                                } else {
                                    Text("Excluir item", color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun DetailTab(text: String, active: Boolean, modifier: Modifier, onClick: () -> Unit) {
    val web = LocalRPWebColors.current
    Column(modifier = modifier.clickable(onClick = onClick).padding(vertical = 10.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Text(text, color = if (active) web.accentDark else web.muted, fontSize = 12.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(8.dp))
        Box(modifier = Modifier.width(42.dp).height(2.dp).background(if (active) web.accent else Color.Transparent))
    }
}

@Composable
private fun DetailSection(title: String, content: @Composable ColumnScope.() -> Unit) {
    val web = LocalRPWebColors.current
    Surface(modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(14.dp), color = web.surfaceSoft, border = BorderStroke(1.dp, web.border)) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(title, color = web.text, fontSize = 13.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(10.dp))
            content()
        }
    }
}

@Composable
private fun DetailLine(label: String, value: String, strong: Boolean = false) {
    val web = LocalRPWebColors.current
    Row(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, color = web.muted, fontSize = 11.sp)
        Text(value, color = web.text, fontSize = 11.5.sp, fontWeight = if (strong) FontWeight.Bold else FontWeight.Medium)
    }
}

@Composable
private fun SelectorField(
    label: String,
    selectedKey: String,
    value: String,
    expanded: Boolean,
    onExpand: () -> Unit,
    onDismiss: () -> Unit,
    options: List<Pair<String, String>>,
    onSelect: (String) -> Unit
) {
    val web = LocalRPWebColors.current
    Column {
        Text(label, color = web.muted, fontSize = 10.5.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(5.dp))
        Box {
            Surface(onClick = onExpand, modifier = Modifier.fillMaxWidth().height(40.dp), shape = RoundedCornerShape(9.dp), color = web.surface, border = BorderStroke(1.dp, web.borderStrong)) {
                Row(modifier = Modifier.fillMaxSize().padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                    Text(value, color = web.text, fontSize = 12.sp)
                    MotionChevron(expanded = expanded, tint = web.muted, modifier = Modifier.size(18.dp))
                }
            }
            MotionDropdownMenu(expanded = expanded, onDismissRequest = onDismiss) {
                options.forEach { (key, text) ->
                    WebSelectorOption(
                        text = text,
                        selected = key == selectedKey,
                        onClick = { onSelect(key) }
                    )
                }
            }
        }
    }
}

private fun effectiveFinancialStatus(order: Order): String = (order.financialStatus ?: order.paymentStatus ?: "PENDENTE").uppercase()

private fun statusInfo(status: String?): Pair<String, String> = when (status?.uppercase()) {
    "PREPARANDO" -> "Em produção" to "orange"
    "PRONTO" -> "Pronto" to "green"
    "ENTREGUE" -> "Entregue" to "purple"
    "CANCELADO" -> "Cancelado" to "pink"
    else -> "Pendente" to "orange"
}

private fun financialLabel(status: String?): String = when (status?.uppercase()) {
    "PAGO" -> "Pago"
    "PARCIAL" -> "Parcial"
    else -> "Pendente"
}

private fun deliveryLabel(value: String?): String = if (value.equals("ENTREGA", true)) "Entrega" else "Retirada"
private fun commandLabel(value: String?): String = if (value.equals("ENCERRADA", true)) "Fechada" else "Aberta"

private fun scheduleLabel(value: String?): String {
    val instant = dashboardParseInstant(value) ?: return "—"
    val local = instant.atZone(ZoneId.systemDefault())
    val now = java.time.LocalDate.now()
    return if (local.toLocalDate() == now) {
        "Hoje, ${local.format(DateTimeFormatter.ofPattern("HH:mm"))}"
    } else {
        local.format(DateTimeFormatter.ofPattern("dd/MM, HH:mm"))
    }
}

private fun isToday(value: String?): Boolean {
    val instant = dashboardParseInstant(value) ?: return false
    return instant.atZone(ZoneId.systemDefault()).toLocalDate() == java.time.LocalDate.now()
}

private fun money(cents: Int): String = NumberFormat.getCurrencyInstance(Locale("pt", "BR")).format(cents / 100.0)
