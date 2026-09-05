package br.com.rpdoces.admin.ui.dashboard

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.weight
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import br.com.rpdoces.admin.data.dashboard.DashboardOrder
import br.com.rpdoces.admin.data.dashboard.DashboardRepository
import br.com.rpdoces.admin.data.dashboard.DashboardSnapshot
import java.text.NumberFormat
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.Locale

@Composable
fun DashboardScreen(
    repository: DashboardRepository,
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
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold
            )
            Text(
                text = message,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodyMedium
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
    modifier: Modifier
) {
    LazyColumn(
        modifier = modifier.fillMaxSize(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        item {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column {
                    Text(
                        text = "Visão de hoje",
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.Bold
                    )
                    Text(
                        text = "Operação da R&P em tempo real",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.bodyMedium
                    )
                }

                if (refreshing) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(24.dp),
                        strokeWidth = 2.dp
                    )
                } else {
                    IconButton(onClick = onRefresh) {
                        Icon(Icons.Outlined.Refresh, contentDescription = "Atualizar dashboard")
                    }
                }
            }
        }

        if (refreshError != null) {
            item {
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(14.dp),
                    color = MaterialTheme.colorScheme.errorContainer
                ) {
                    Text(
                        text = refreshError,
                        modifier = Modifier.padding(14.dp),
                        color = MaterialTheme.colorScheme.onErrorContainer,
                        style = MaterialTheme.typography.bodyMedium
                    )
                }
            }
        }

        item {
            MetricRow(
                left = Metric("Receita paga", money(snapshot.paidRevenueTodayCents), "${snapshot.paidTodayCount} pagos hoje"),
                right = Metric("Pedidos hoje", snapshot.ordersTodayCount.toString(), "Criados hoje")
            )
        }

        item {
            MetricRow(
                left = Metric("Pagamentos", snapshot.pendingPaymentCount.toString(), "Aguardando pagamento"),
                right = Metric("Preparação", snapshot.waitingPreparationCount.toString(), "Pagos aguardando preparo")
            )
        }

        item {
            MetricRow(
                left = Metric("Produtos", snapshot.productCount.toString(), "No catálogo"),
                right = Metric("Estoque baixo", snapshot.lowStockCount.toString(), "${snapshot.soldOutCount} esgotados")
            )
        }

        item { SectionTitle("Atenção") }

        if (snapshot.attention.isEmpty()) {
            item {
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(16.dp),
                    color = MaterialTheme.colorScheme.surface
                ) {
                    Column(
                        modifier = Modifier.padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        Text("Tudo em ordem", fontWeight = FontWeight.Bold)
                        Text(
                            "Nenhuma pendência operacional detectada agora.",
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            }
        } else {
            items(snapshot.attention) { attention -> AttentionRow(attention) }
        }

        item { SectionTitle("Pedidos recentes") }

        if (snapshot.recentOrders.isEmpty()) {
            item {
                Text(
                    text = "Nenhum pedido por enquanto.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(vertical = 8.dp)
                )
            }
        } else {
            items(snapshot.recentOrders, key = { it.id }) { order -> RecentOrderCard(order) }
        }
    }
}

private data class Metric(
    val label: String,
    val value: String,
    val supporting: String
)

@Composable
private fun MetricRow(left: Metric, right: Metric) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        MetricCard(left, Modifier.weight(1f))
        MetricCard(right, Modifier.weight(1f))
    }
}

@Composable
private fun MetricCard(metric: Metric, modifier: Modifier = Modifier) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(18.dp),
        color = MaterialTheme.colorScheme.surface,
        tonalElevation = 1.dp
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            Text(
                text = metric.label,
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Text(
                text = metric.value,
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Bold
            )
            Text(
                text = metric.supporting,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

@Composable
private fun SectionTitle(text: String) {
    Text(
        text = text,
        style = MaterialTheme.typography.titleMedium,
        fontWeight = FontWeight.Bold,
        modifier = Modifier.padding(top = 4.dp)
    )
}

@Composable
private fun AttentionRow(text: String) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(14.dp),
        color = MaterialTheme.colorScheme.primaryContainer
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Box(
                modifier = Modifier
                    .size(8.dp)
                    .background(MaterialTheme.colorScheme.primary, CircleShape)
            )
            Text(
                text = text,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onPrimaryContainer
            )
        }
    }
}

@Composable
private fun RecentOrderCard(order: DashboardOrder) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.surface
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column {
                    Text("Pedido #${order.id}", fontWeight = FontWeight.Bold)
                    Text(
                        order.customerName?.takeIf { it.isNotBlank() } ?: "Cliente não informado",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.bodyMedium
                    )
                }
                Text(
                    money(order.totalCents),
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.primary
                )
            }

            HorizontalDivider(color = MaterialTheme.colorScheme.outline)

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text(
                    orderStatusLabel(order.orderStatus),
                    style = MaterialTheme.typography.labelMedium
                )
                Text(
                    "${paymentStatusLabel(order.paymentStatus)} · ${dateLabel(order.createdAt)}",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}

private fun money(cents: Int): String = NumberFormat
    .getCurrencyInstance(Locale("pt", "BR"))
    .format(cents / 100.0)

private fun orderStatusLabel(status: String?): String = when (status?.uppercase()) {
    "PREPARANDO" -> "Em produção"
    "PRONTO" -> "Pronto"
    "ENTREGUE" -> "Entregue"
    "CANCELADO" -> "Cancelado"
    else -> "Pendente"
}

private fun paymentStatusLabel(status: String?): String = when (status?.uppercase()) {
    "PAGO" -> "Pago"
    "CANCELADO" -> "Cancelado"
    else -> "Pagamento pendente"
}

private fun dateLabel(value: String?): String {
    val instant = parseInstant(value) ?: return "—"
    val time = instant.atZone(ZoneId.systemDefault())
    return time.format(DateTimeFormatter.ofPattern("dd/MM · HH:mm"))
}

private fun parseInstant(value: String?): Instant? {
    val text = value?.trim().orEmpty()
    if (text.isBlank()) return null
    return runCatching { Instant.parse(text) }.getOrNull()
        ?: runCatching { OffsetDateTime.parse(text).toInstant() }.getOrNull()
        ?: runCatching {
            LocalDateTime.parse(text, DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"))
                .toInstant(ZoneOffset.UTC)
        }.getOrNull()
        ?: runCatching { LocalDateTime.parse(text).toInstant(ZoneOffset.UTC) }.getOrNull()
}
