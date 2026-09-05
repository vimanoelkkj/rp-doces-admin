package br.com.rpdoces.admin.ui.dashboard

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import br.com.rpdoces.admin.data.dashboard.DashboardOrder
import br.com.rpdoces.admin.data.dashboard.DashboardOrderItem
import br.com.rpdoces.admin.data.dashboard.DashboardSnapshot
import br.com.rpdoces.admin.data.dashboard.availableStock
import br.com.rpdoces.admin.data.dashboard.dashboardParseInstant
import br.com.rpdoces.admin.ui.theme.LocalRPWebColors
import java.text.NumberFormat
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

@Composable
internal fun ReceivablesPanelNative(
    snapshot: DashboardSnapshot,
    onOpenOrders: () -> Unit,
    modifier: Modifier = Modifier
) {
    val web = LocalRPWebColors.current
    val receivables = snapshot.orders.filter {
        it.balanceCents > 0 && !it.orderStatus.equals("CANCELADO", ignoreCase = true)
    }
    val pendingTotal = receivables.sumOf { it.balanceCents }
    var expandedId by rememberSaveable { mutableIntStateOf(-1) }

    LaunchedEffect(receivables.firstOrNull()?.id) {
        if (expandedId == -1) expandedId = receivables.firstOrNull()?.id ?: 0
    }

    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(14.dp),
        color = web.surfaceVeilTwo,
        border = BorderStroke(1.dp, web.border)
    ) {
        Column(modifier = Modifier.padding(horizontal = 20.dp, vertical = 18.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(16.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text("Pagamentos pendentes", fontSize = 14.sp, fontWeight = FontWeight.Bold, color = web.text)
                    Text(
                        "${receivables.size} cliente${if (receivables.size == 1) "" else "s"} com saldo a receber",
                        modifier = Modifier.padding(top = 2.dp),
                        color = web.muted,
                        fontSize = 11.5.sp
                    )
                }
                Text(
                    moneyPanel(pendingTotal),
                    color = web.accentDark,
                    fontSize = 17.sp,
                    fontWeight = FontWeight.Bold
                )
            }

            if (receivables.isEmpty()) {
                Column(
                    modifier = Modifier.fillMaxWidth().padding(top = 20.dp, bottom = 10.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Text("Nenhum valor pendente", color = web.text, fontSize = 12.5.sp, fontWeight = FontWeight.Bold)
                    Text(
                        "As comandas com saldo a receber aparecerão aqui.",
                        modifier = Modifier.padding(top = 4.dp),
                        color = web.muted,
                        fontSize = 10.5.sp
                    )
                }
            } else {
                receivables.take(6).forEachIndexed { index, order ->
                    if (index > 0) HorizontalDivider(color = web.border)
                    ReceivableOrderRow(
                        order = order,
                        expanded = expandedId == order.id,
                        onToggle = { expandedId = if (expandedId == order.id) 0 else order.id },
                        onOpenOrders = onOpenOrders
                    )
                }
            }
        }
    }
}

@Composable
private fun ReceivableOrderRow(
    order: DashboardOrder,
    expanded: Boolean,
    onToggle: () -> Unit,
    onOpenOrders: () -> Unit
) {
    val web = LocalRPWebColors.current

    Column(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clickable(onClick = onToggle)
                .padding(horizontal = 4.dp, vertical = 13.dp),
            verticalAlignment = Alignment.Top,
            horizontalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    order.customerName ?: "Cliente não informado",
                    color = web.text,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Bold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Text(
                    "Pedido #${order.id} · ${order.itens.size} item${if (order.itens.size == 1) "" else "s"}",
                    modifier = Modifier.padding(top = 2.dp),
                    color = web.muted,
                    fontSize = 11.sp
                )
            }
            Text(
                "${moneyPanel(order.balanceCents)} pendentes",
                color = web.tagOrangeText,
                fontSize = 12.5.sp,
                fontWeight = FontWeight.Bold
            )
            Text(
                if (expanded) "⌃" else "⌄",
                color = web.muted,
                fontSize = 16.sp,
                lineHeight = 16.sp
            )
        }

        if (expanded) {
            Column(modifier = Modifier.padding(start = 4.dp, end = 4.dp, bottom = 16.dp)) {
                order.itens.forEachIndexed { index, item ->
                    if (index > 0) DashedDivider()
                    ReceivableItemRow(item)
                }

                HorizontalDivider(modifier = Modifier.padding(top = 4.dp), color = web.border)
                Row(
                    modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    FinancialSummary("Total", order.totalCents, Modifier.weight(1f))
                    FinancialSummary("Pago", order.paidCents, Modifier.weight(1f))
                    FinancialSummary("Restante", order.balanceCents, Modifier.weight(1f))
                }

                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 12.dp)
                        .height(34.dp)
                        .background(
                            Brush.verticalGradient(listOf(androidx.compose.ui.graphics.Color(0xFFDC4E6D), androidx.compose.ui.graphics.Color(0xFFCE3D5F))),
                            RoundedCornerShape(9.dp)
                        )
                        .clickable(onClick = onOpenOrders),
                    contentAlignment = Alignment.Center
                ) {
                    Text("Abrir comanda", color = androidx.compose.ui.graphics.Color.White, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}

@Composable
private fun ReceivableItemRow(item: DashboardOrderItem) {
    val web = LocalRPWebColors.current
    val status = item.financialStatus.orEmpty().uppercase().ifBlank { "PENDENTE" }
    val paid = status == "PAGO"
    val detail = when (status) {
        "PAGO" -> "${moneyPanel(item.paidCents)} pagos"
        "PARCIAL" -> "${moneyPanel(item.paidCents)} pagos · ${moneyPanel(item.balanceCents)} pendentes"
        else -> "${moneyPanel(item.balanceCents)} pendentes"
    }

    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 9.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                "${item.quantidade}× ${item.productName ?: "Produto"}",
                color = web.text,
                fontSize = 12.sp,
                fontWeight = FontWeight.Bold
            )
            Text(detail, modifier = Modifier.padding(top = 2.dp), color = web.muted, fontSize = 10.5.sp)
        }
        Surface(
            shape = RoundedCornerShape(8.dp),
            color = if (paid) web.greenSoft else web.orangeSoft
        ) {
            Text(
                if (paid) "Pago" else if (status == "PARCIAL") "Parcial" else "Pendente",
                modifier = Modifier.padding(horizontal = 9.dp, vertical = 5.dp),
                color = if (paid) web.tagGreenText else web.tagOrangeText,
                fontSize = 10.sp,
                lineHeight = 10.sp,
                fontWeight = FontWeight.SemiBold
            )
        }
    }
}

@Composable
private fun FinancialSummary(label: String, cents: Int, modifier: Modifier = Modifier) {
    val web = LocalRPWebColors.current
    Column(modifier = modifier) {
        Text(label, color = web.muted, fontSize = 11.5.sp)
        Text(moneyPanel(cents), color = web.text, fontSize = 13.sp, fontWeight = FontWeight.Bold)
    }
}

@Composable
internal fun RecentOrdersPanelNative(
    orders: List<DashboardOrder>,
    onOpenOrders: () -> Unit,
    modifier: Modifier = Modifier
) {
    val web = LocalRPWebColors.current
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(14.dp),
        color = web.surfaceVeilTwo,
        border = BorderStroke(1.dp, web.border)
    ) {
        Column(modifier = Modifier.padding(horizontal = 20.dp, vertical = 18.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.Top
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text("Pedidos recentes", color = web.text, fontSize = 14.sp, fontWeight = FontWeight.Bold)
                    Text("Últimas movimentações da loja", modifier = Modifier.padding(top = 2.dp), color = web.muted, fontSize = 11.5.sp)
                }
                Text(
                    "Ver pedidos",
                    modifier = Modifier.clickable(onClick = onOpenOrders).padding(start = 10.dp, top = 2.dp),
                    color = web.accentDark,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Bold
                )
            }

            if (orders.isEmpty()) {
                Text(
                    "Os pedidos mais recentes aparecerão nesta área.",
                    modifier = Modifier.padding(top = 22.dp, bottom = 12.dp),
                    color = web.muted,
                    fontSize = 11.5.sp
                )
            } else {
                orders.take(4).forEachIndexed { index, order ->
                    if (index > 0) HorizontalDivider(color = web.border)
                    RecentOrderRow(order)
                }
            }
        }
    }
}

@Composable
private fun RecentOrderRow(order: DashboardOrder) {
    val web = LocalRPWebColors.current
    Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 12.dp)) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Column {
                Text("RP-${order.id}", color = web.accentDark, fontSize = 11.5.sp, fontWeight = FontWeight.Bold)
                Text(orderTime(order), modifier = Modifier.padding(top = 1.dp), color = web.muted, fontSize = 10.5.sp)
            }
            Text(moneyPanel(order.totalCents), color = web.text, fontSize = 12.5.sp, fontWeight = FontWeight.Bold)
        }
        Text(
            order.customerName ?: "Cliente",
            modifier = Modifier.padding(top = 5.dp),
            color = web.text,
            fontSize = 12.5.sp,
            fontWeight = FontWeight.Bold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
        Text(
            order.customerWhatsapp ?: order.customerEmail ?: "—",
            modifier = Modifier.padding(top = 1.dp),
            color = web.muted,
            fontSize = 10.5.sp,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
    }
}

@Composable
internal fun AttentionPanelNative(
    snapshot: DashboardSnapshot,
    modifier: Modifier = Modifier
) {
    val web = LocalRPWebColors.current
    val receivables = snapshot.orders.filter {
        it.balanceCents > 0 && !it.orderStatus.equals("CANCELADO", ignoreCase = true)
    }
    val receivableTotal = receivables.sumOf { it.balanceCents }
    val soldOut = snapshot.products.filter { it.ativo && availableStock(it) <= 0 }
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
    }

    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(14.dp),
        color = web.surfaceVeilTwo,
        border = BorderStroke(1.dp, web.border)
    ) {
        Column(modifier = Modifier.padding(horizontal = 20.dp, vertical = 18.dp)) {
            Text("Precisa de atenção", color = web.text, fontSize = 14.sp, fontWeight = FontWeight.Bold)
            Text("Pontos que podem exigir uma ação", modifier = Modifier.padding(top = 2.dp), color = web.muted, fontSize = 11.5.sp)

            if (attention.isEmpty()) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 14.dp)
                        .background(web.greenSoft, RoundedCornerShape(10.dp))
                        .padding(horizontal = 12.dp, vertical = 14.dp),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text("✓", color = web.tagGreenText, fontSize = 18.sp)
                    Column {
                        Text("Tudo tranquilo por aqui", color = web.text, fontSize = 12.5.sp, fontWeight = FontWeight.Bold)
                        Text("Nenhuma pendência operacional detectada.", color = web.muted, fontSize = 11.sp)
                    }
                }
            } else {
                Column(modifier = Modifier.padding(top = 14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    attention.forEach { item ->
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
                    }
                }
            }
        }
    }
}

@Composable
private fun DashedDivider() {
    val web = LocalRPWebColors.current
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(1.dp)
            .drawBehind {
                drawLine(
                    color = web.border,
                    start = Offset(0f, 0f),
                    end = Offset(size.width, 0f),
                    strokeWidth = 1.dp.toPx(),
                    pathEffect = PathEffect.dashPathEffect(floatArrayOf(5.dp.toPx(), 4.dp.toPx()))
                )
            }
    )
}

private fun orderTime(order: DashboardOrder): String {
    val instant = dashboardParseInstant(order.createdAt) ?: return "—"
    return DateTimeFormatter.ofPattern("HH:mm").format(instant.atZone(ZoneId.systemDefault()))
}

private fun moneyPanel(cents: Int): String = NumberFormat
    .getCurrencyInstance(Locale("pt", "BR"))
    .format(cents / 100.0)
