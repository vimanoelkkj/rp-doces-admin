package br.com.rpdoces.admin.ui.dashboard

import android.app.DatePickerDialog
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.ChevronLeft
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import br.com.rpdoces.admin.data.dashboard.DashboardProduct
import br.com.rpdoces.admin.data.dashboard.DashboardRepository
import br.com.rpdoces.admin.data.dashboard.DashboardSnapshot
import br.com.rpdoces.admin.data.dashboard.dashboardParseInstant
import br.com.rpdoces.admin.data.dashboard.effectivePaymentStatus
import br.com.rpdoces.admin.ui.remote.LocalAppRemoteConfig
import br.com.rpdoces.admin.ui.theme.LocalRPWebColors
import java.text.NumberFormat
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.util.Locale

private val WarningOrange = Color(0xFFF0A04F)

@Composable
fun DashboardScreen(
    repository: DashboardRepository,
    onOpenOrders: () -> Unit = {},
    modifier: Modifier = Modifier
) {
    val dashboardViewModel: DashboardViewModel = viewModel(
        factory = DashboardViewModel.factory(repository)
    )
    val state by dashboardViewModel.state.collectAsStateWithLifecycle()

    when (val current = state) {
        DashboardUiState.Loading -> DashboardLoading(modifier)
        is DashboardUiState.Error -> DashboardError(
            message = current.message,
            onRetry = dashboardViewModel::refresh,
            modifier = modifier
        )
        is DashboardUiState.Ready -> DashboardContent(
            snapshot = current.snapshot,
            refreshing = current.refreshing,
            refreshError = current.refreshError,
            onRefresh = dashboardViewModel::refresh,
            onOpenOrders = onOpenOrders,
            modifier = modifier
        )
    }
}

@Composable
private fun DashboardLoading(modifier: Modifier) {
    Box(
        modifier = modifier.fillMaxSize(),
        contentAlignment = Alignment.Center
    ) {
        CircularProgressIndicator()
    }
}

@Composable
private fun DashboardError(
    message: String,
    onRetry: () -> Unit,
    modifier: Modifier
) {
    Box(
        modifier = modifier
            .fillMaxSize()
            .padding(24.dp),
        contentAlignment = Alignment.Center
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Icon(
                imageVector = Icons.Outlined.ErrorOutline,
                contentDescription = null,
                modifier = Modifier.size(38.dp),
                tint = MaterialTheme.colorScheme.error
            )
            Text(
                text = "Não foi possível carregar o dashboard",
                fontSize = 16.sp,
                fontWeight = FontWeight.Bold
            )
            Text(
                text = message,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                fontSize = 13.sp
            )
            Button(onClick = onRetry) {
                Text("Tentar novamente")
            }
        }
    }
}

@Composable
private fun DashboardContent(
    snapshot: DashboardSnapshot,
    refreshing: Boolean,
    refreshError: String?,
    onRefresh: () -> Unit,
    onOpenOrders: () -> Unit,
    modifier: Modifier
) {
    var dayOffset by rememberSaveable { mutableIntStateOf(0) }
    val today = remember { LocalDate.now() }
    val selectedDate = today.plusDays(dayOffset.toLong())
    val context = LocalContext.current
    val metrics = remember(snapshot, selectedDate) { selectedDayMetrics(snapshot, selectedDate) }
    val topFlavors = remember(snapshot) { topFlavors(snapshot) }
    val remoteConfig = LocalAppRemoteConfig.current
    val features = remoteConfig.features
    val remoteBanner = remoteConfig.dashboardBanner

    fun openDatePicker() {
        DatePickerDialog(
            context,
            { _, year, month, day ->
                val picked = LocalDate.of(year, month + 1, day)
                if (!picked.isAfter(today)) {
                    dayOffset = ChronoUnit.DAYS.between(today, picked).toInt()
                }
            },
            selectedDate.year,
            selectedDate.monthValue - 1,
            selectedDate.dayOfMonth
        ).apply {
            datePicker.maxDate = System.currentTimeMillis()
        }.show()
    }

    LazyColumn(
        modifier = modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = 12.dp, end = 12.dp, top = 18.dp, bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(0.dp)
    ) {
        item {
            DayNavigator(
                selectedDate = selectedDate,
                dayOffset = dayOffset,
                onPrevious = { dayOffset -= 1 },
                onNext = { if (dayOffset < 0) dayOffset += 1 },
                onToday = { dayOffset = 0 },
                onOpenCalendar = ::openDatePicker,
                refreshing = refreshing
            )
        }

        if (refreshError != null) {
            item {
                Surface(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 12.dp),
                    shape = RoundedCornerShape(10.dp),
                    color = MaterialTheme.colorScheme.errorContainer
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = refreshError,
                            modifier = Modifier.weight(1f),
                            color = MaterialTheme.colorScheme.onErrorContainer,
                            fontSize = 11.sp
                        )
                        Spacer(Modifier.width(8.dp))
                        OutlinedButton(onClick = onRefresh, contentPadding = PaddingValues(horizontal = 10.dp)) {
                            Text("Tentar", fontSize = 10.sp)
                        }
                    }
                }
            }
        }

        if (remoteBanner.enabled && (remoteBanner.title.isNotBlank() || remoteBanner.message.isNotBlank())) {
            item(key = "remote-banner-${remoteConfig.revision}") {
                RemoteDashboardBanner(
                    banner = remoteBanner,
                    modifier = Modifier.padding(top = 16.dp)
                )
            }
        }

        remoteConfig.dashboardSectionOrder.forEach { section ->
            when (section) {
                "metrics" -> if (features.dashboardMetrics) {
                    item(key = "remote-section-metrics") {
                        Box(modifier = Modifier.padding(top = 20.dp)) {
                            MetricsGrid(metrics, snapshot, todaySelected = dayOffset == 0)
                        }
                    }
                }

                "flavors" -> if (features.dashboardFlavors) {
                    item(key = "remote-section-flavors") {
                        FlavorPanel(
                            flavors = topFlavors,
                            modifier = Modifier.padding(top = 20.dp)
                        )
                    }
                }

                "receivables" -> if (features.dashboardReceivables) {
                    item(key = "remote-section-receivables") {
                        ReceivablesPanelNative(
                            snapshot = snapshot,
                            onOpenOrders = onOpenOrders,
                            modifier = Modifier.padding(top = 20.dp)
                        )
                    }
                }

                "recent_orders" -> if (features.dashboardRecentOrders) {
                    item(key = "remote-section-recent-orders") {
                        RecentOrdersPanelNative(
                            orders = snapshot.orders,
                            onOpenOrders = onOpenOrders,
                            modifier = Modifier.padding(top = 20.dp)
                        )
                    }
                }

                "attention" -> if (features.dashboardAttention) {
                    item(key = "remote-section-attention") {
                        AttentionPanelNative(
                            snapshot = snapshot,
                            modifier = Modifier.padding(top = 20.dp)
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun DayNavigator(
    selectedDate: LocalDate,
    dayOffset: Int,
    onPrevious: () -> Unit,
    onNext: () -> Unit,
    onToday: () -> Unit,
    onOpenCalendar: () -> Unit,
    refreshing: Boolean
) {
    Column {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.Top
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(
                    text = "Resultados por dia",
                    color = MaterialTheme.colorScheme.onBackground,
                    fontSize = 14.sp,
                    lineHeight = 18.sp,
                    fontWeight = FontWeight.Bold
                )
                Text(
                    text = daySubtitle(dayOffset),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    fontSize = 11.5.sp,
                    lineHeight = 15.sp
                )
            }

            if (refreshing) {
                CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 1.5.dp)
            }
        }

        Spacer(Modifier.height(16.dp))

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            CompactButton(onClick = onPrevious, modifier = Modifier.size(30.dp)) {
                Icon(Icons.Outlined.ChevronLeft, null, modifier = Modifier.size(15.dp))
            }

            CompactButton(
                onClick = onOpenCalendar,
                modifier = Modifier.width(116.dp)
            ) {
                Icon(
                    Icons.Outlined.CalendarMonth,
                    null,
                    modifier = Modifier.size(15.dp),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Spacer(Modifier.width(7.dp))
                Text(
                    selectedDate.format(DateTimeFormatter.ofPattern("dd/MM/yyyy")),
                    fontSize = 11.5.sp,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1
                )
            }

            CompactButton(
                onClick = onNext,
                modifier = Modifier.size(30.dp),
                enabled = dayOffset < 0
            ) {
                Icon(Icons.Outlined.ChevronRight, null, modifier = Modifier.size(15.dp))
            }

            CompactButton(
                onClick = onToday,
                modifier = Modifier.width(52.dp),
                active = dayOffset == 0
            ) {
                Text("Hoje", fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
            }
        }

        Spacer(Modifier.height(14.dp))
        HorizontalDivider(color = MaterialTheme.colorScheme.outline)
        Spacer(Modifier.height(2.dp))
    }
}

@Composable
private fun CompactButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    active: Boolean = false,
    content: @Composable () -> Unit
) {
    Surface(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier.height(30.dp),
        shape = RoundedCornerShape(8.dp),
        color = if (active) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surface,
        border = BorderStroke(
            1.dp,
            if (active) MaterialTheme.colorScheme.primary.copy(alpha = .55f) else MaterialTheme.colorScheme.outline
        )
    ) {
        Row(
            modifier = Modifier.fillMaxSize(),
            horizontalArrangement = Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically
        ) {
            content()
        }
    }
}

private data class DayMetrics(
    val receivedCents: Int,
    val receivedCount: Int,
    val receivableCents: Int,
    val receivableCount: Int,
    val openCommands: Int,
    val waitingPreparation: Int
)

private fun selectedDayMetrics(snapshot: DashboardSnapshot, selectedDate: LocalDate): DayMetrics {
    val zone = ZoneId.systemDefault()
    val received = snapshot.orders.flatMap { order ->
        order.pagamentos.filter { payment ->
            (payment.status ?: "").equals("PAGO", ignoreCase = true) &&
                dashboardParseInstant(payment.paidAt ?: payment.updatedAt)
                    ?.atZone(zone)?.toLocalDate() == selectedDate
        }
    }
    val receivables = snapshot.orders.filter { order ->
        order.balanceCents > 0 && !order.orderStatus.equals("CANCELADO", true)
    }
    val openCommands = snapshot.orders.count { order ->
        (order.commandStatus ?: "ABERTA").equals("ABERTA", true) &&
            !order.orderStatus.equals("CANCELADO", true)
    }
    val waiting = snapshot.orders.count { order ->
        effectivePaymentStatus(order) == "PAGO" && order.orderStatus.equals("NOVO", true)
    }

    return DayMetrics(
        receivedCents = received.sumOf { it.valueCents },
        receivedCount = received.size,
        receivableCents = receivables.sumOf { it.balanceCents },
        receivableCount = receivables.size,
        openCommands = openCommands,
        waitingPreparation = waiting
    )
}

@Composable
private fun MetricsGrid(metrics: DayMetrics, snapshot: DashboardSnapshot, todaySelected: Boolean) {
    Column {
        MetricPair(
            left = MetricSpec(
                label = if (todaySelected) "RECEBIDO HOJE" else "RECEBIDO NO DIA",
                value = money(metrics.receivedCents),
                supporting = "${metrics.receivedCount} pagamento${if (metrics.receivedCount == 1) " confirmado" else "s confirmados"}",
                accent = MaterialTheme.colorScheme.primary,
                labelColor = MaterialTheme.colorScheme.primary
            ),
            right = MetricSpec(
                label = "A RECEBER",
                value = money(metrics.receivableCents),
                supporting = "${metrics.receivableCount} cliente${if (metrics.receivableCount == 1) "" else "s"} com saldo pendente",
                accent = if (metrics.receivableCount > 0) WarningOrange else MaterialTheme.colorScheme.outline,
                supportingColor = if (metrics.receivableCount > 0) WarningOrange else null
            )
        )

        Spacer(Modifier.height(14.dp))

        MetricPair(
            left = MetricSpec(
                label = "COMANDAS ABERTAS",
                value = metrics.openCommands.toString(),
                supporting = "Clientes ainda em atendimento"
            ),
            right = MetricSpec(
                label = "AGUARDANDO PREPARO",
                value = metrics.waitingPreparation.toString(),
                supporting = "Pedidos pagos que ainda estão novos",
                accent = if (metrics.waitingPreparation > 0) WarningOrange else null,
                supportingColor = if (metrics.waitingPreparation > 0) WarningOrange else null
            ),
            topBorder = true
        )

        Spacer(Modifier.height(14.dp))

        Row(modifier = Modifier.fillMaxWidth()) {
            MetricCell(
                metric = MetricSpec(
                    label = "CATÁLOGO",
                    value = snapshot.productCount.toString(),
                    supporting = "${snapshot.soldOutCount} esgotado${if (snapshot.soldOutCount == 1) "" else "s"} · ${snapshot.lowStockCount} estoque baixo",
                    accent = if (snapshot.soldOutCount > 0 || snapshot.lowStockCount > 0) WarningOrange else MaterialTheme.colorScheme.outline,
                    supportingColor = if (snapshot.soldOutCount > 0 || snapshot.lowStockCount > 0) WarningOrange else null
                ),
                modifier = Modifier.weight(1f),
                topBorder = true
            )
            Spacer(Modifier.weight(1f))
        }
    }
}

private data class MetricSpec(
    val label: String,
    val value: String,
    val supporting: String,
    val accent: Color? = null,
    val labelColor: Color? = null,
    val supportingColor: Color? = null
)

@Composable
private fun MetricPair(
    left: MetricSpec,
    right: MetricSpec,
    topBorder: Boolean = false
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(105.dp)
    ) {
        MetricCell(
            metric = left,
            modifier = Modifier.weight(1f),
            startPadding = 0.dp,
            topBorder = topBorder
        )
        Box(
            modifier = Modifier
                .width(1.dp)
                .fillMaxHeight()
                .background(MaterialTheme.colorScheme.outline)
        )
        MetricCell(
            metric = right,
            modifier = Modifier.weight(1f),
            startPadding = 18.dp,
            topBorder = topBorder
        )
    }
}

@Composable
private fun MetricCell(
    metric: MetricSpec,
    modifier: Modifier = Modifier,
    startPadding: Dp = 0.dp,
    topBorder: Boolean = false
) {
    Box(
        modifier = modifier.height(105.dp)
    ) {
        if (topBorder) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(1.dp)
                    .background(MaterialTheme.colorScheme.outline)
                    .align(Alignment.TopStart)
            )
        }

        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(
                    start = startPadding,
                    top = if (topBorder) 12.dp else 4.dp,
                    end = 18.dp,
                    bottom = 15.dp
                )
        ) {
            Text(
                text = metric.label,
                color = metric.labelColor ?: MaterialTheme.colorScheme.onSurfaceVariant,
                fontSize = 10.5.sp,
                lineHeight = 14.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = .4.sp
            )
            Text(
                text = metric.value,
                modifier = Modifier.padding(top = 6.dp),
                color = MaterialTheme.colorScheme.onBackground,
                fontSize = 20.sp,
                lineHeight = 25.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = (-0.3).sp
            )
            Text(
                text = metric.supporting,
                modifier = Modifier.padding(top = 3.dp),
                color = metric.supportingColor ?: MaterialTheme.colorScheme.onSurfaceVariant,
                fontSize = 10.5.sp,
                lineHeight = 14.7.sp,
                fontWeight = if (metric.supportingColor != null) FontWeight.SemiBold else FontWeight.Normal,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis
            )
        }

        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(2.dp)
                .background(metric.accent ?: MaterialTheme.colorScheme.outline)
                .align(Alignment.BottomStart)
        )
    }
}

private data class FlavorStat(
    val name: String,
    val category: String,
    val count: Int
)

private fun topFlavors(snapshot: DashboardSnapshot): List<FlavorStat> {
    val zone = ZoneId.systemDefault()
    val cutoff = LocalDate.now().minusDays(30)
    val productById = snapshot.products.associateBy { it.id }
    val counts = linkedMapOf<String, FlavorStat>()

    snapshot.orders.forEach { order ->
        val paidDate = dashboardParseInstant(order.paidAt ?: order.updatedAt)
            ?.atZone(zone)?.toLocalDate()
        if (effectivePaymentStatus(order) != "PAGO" || paidDate == null || paidDate.isBefore(cutoff)) return@forEach

        val items = if (order.itens.isNotEmpty()) order.itens else listOf(
            br.com.rpdoces.admin.data.dashboard.DashboardOrderItem(
                productId = order.productId,
                productName = order.productName,
                quantidade = order.quantidade
            )
        )

        items.forEach { item ->
            val name = item.productName?.takeIf { it.isNotBlank() } ?: "Produto"
            val product: DashboardProduct? = item.productId?.let(productById::get)
            val category = product?.categoryName ?: product?.categoria ?: "Catálogo"
            val key = item.productId?.toString() ?: name
            val old = counts[key]
            counts[key] = FlavorStat(
                name = name,
                category = category,
                count = (old?.count ?: 0) + item.quantidade.coerceAtLeast(0)
            )
        }
    }

    return counts.values.sortedByDescending { it.count }.take(4)
}

@Composable
private fun FlavorPanel(flavors: List<FlavorStat>, modifier: Modifier = Modifier) {
    val web = LocalRPWebColors.current
    val total = flavors.sumOf { it.count }
    val max = flavors.maxOfOrNull { it.count }?.coerceAtLeast(1) ?: 1

    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(14.dp),
        color = web.surfaceVeilTwo,
        border = BorderStroke(1.dp, web.border)
    ) {
        Column(modifier = Modifier.padding(horizontal = 20.dp, vertical = 18.dp)) {
            Text(
                text = "Sabores de bolo mais vendidos",
                color = web.text,
                fontSize = 14.sp,
                fontWeight = FontWeight.Bold
            )
            Text(
                text = "Últimos 30 dias · pedidos pagos · $total unidades no Top 4",
                modifier = Modifier.padding(top = 4.dp),
                color = web.muted,
                fontSize = 11.5.sp,
                lineHeight = 15.5.sp
            )

            if (flavors.isEmpty()) {
                Text(
                    text = "Ainda não há vendas pagas suficientes para formar o ranking.",
                    modifier = Modifier.padding(top = 18.dp, bottom = 4.dp),
                    color = web.muted,
                    fontSize = 11.5.sp
                )
            } else {
                flavors.forEachIndexed { index, flavor ->
                    if (index > 0) HorizontalDivider(color = web.border)
                    FlavorRow(
                        rank = index + 1,
                        flavor = flavor,
                        fraction = flavor.count.toFloat() / max.toFloat()
                    )
                }
            }
        }
    }
}

@Composable
private fun FlavorRow(rank: Int, flavor: FlavorStat, fraction: Float) {
    val web = LocalRPWebColors.current
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 4.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        Surface(
            modifier = Modifier.size(26.dp),
            shape = RoundedCornerShape(13.dp),
            color = web.accentSoft
        ) {
            Box(contentAlignment = Alignment.Center) {
                Text(
                    rank.toString(),
                    color = web.accentDark,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Bold
                )
            }
        }

        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = flavor.name,
                color = web.text,
                fontSize = 13.sp,
                lineHeight = 17.sp,
                fontWeight = FontWeight.Bold,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis
            )
            Text(
                text = flavor.category,
                color = web.muted,
                fontSize = 11.sp
            )
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 7.dp)
                    .height(5.dp)
                    .background(web.border, RoundedCornerShape(99.dp))
            ) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth(fraction.coerceIn(0f, 1f))
                        .height(5.dp)
                        .background(web.accent, RoundedCornerShape(99.dp))
                )
            }
        }

        Column(horizontalAlignment = Alignment.End) {
            Text(
                text = "${flavor.count} un.",
                color = web.text,
                fontSize = 12.5.sp,
                fontWeight = FontWeight.Bold
            )
            Text(
                text = "≈ ${(flavor.count / 4.3).toLocale1()}/sem",
                modifier = Modifier.padding(top = 3.dp),
                color = web.muted,
                fontSize = 10.5.sp
            )
        }
    }
}

private fun daySubtitle(offset: Int): String = when (offset) {
    0 -> "Hoje"
    -1 -> "Ontem"
    else -> "${-offset} dias atrás"
}

private fun money(cents: Int): String = NumberFormat
    .getCurrencyInstance(Locale("pt", "BR"))
    .format(cents / 100.0)

private fun Double.toLocale1(): String = String.format(Locale("pt", "BR"), "%.1f", this)
