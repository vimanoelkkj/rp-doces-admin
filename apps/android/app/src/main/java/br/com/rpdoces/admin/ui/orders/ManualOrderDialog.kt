package br.com.rpdoces.admin.ui.orders

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.KeyboardArrowDown
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
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
import br.com.rpdoces.admin.data.orders.ManualOrderInput
import br.com.rpdoces.admin.data.orders.ManualOrderItemInput
import br.com.rpdoces.admin.data.orders.OrdersRepository
import br.com.rpdoces.admin.data.products.Product
import br.com.rpdoces.admin.data.products.ProductsRepository
import br.com.rpdoces.admin.ui.components.WebField
import br.com.rpdoces.admin.ui.components.WebModal
import br.com.rpdoces.admin.ui.components.WebModalActions
import br.com.rpdoces.admin.ui.components.WebModalHeader
import br.com.rpdoces.admin.ui.theme.LocalRPWebColors
import java.text.NumberFormat
import java.util.Locale
import kotlinx.coroutines.launch

private val manualPaymentMethods = listOf(
    "PIX_EXTERNO" to "Pix",
    "CARTAO" to "Cartão",
    "DINHEIRO" to "Dinheiro",
    "A_COMBINAR" to "A combinar"
)

private val manualPaymentStatuses = listOf(
    "PENDENTE" to "Pendente",
    "PAGO" to "Pago"
)

@Composable
internal fun ManualOrderDialog(
    ordersRepository: OrdersRepository,
    productsRepository: ProductsRepository,
    onDismiss: () -> Unit,
    onCreated: (Int) -> Unit
) {
    val web = LocalRPWebColors.current
    val scope = rememberCoroutineScope()
    var products by remember { mutableStateOf<List<Product>>(emptyList()) }
    val quantities = remember { mutableStateMapOf<Int, Int>() }
    var loading by remember { mutableStateOf(true) }
    var saving by remember { mutableStateOf(false) }
    var customer by remember { mutableStateOf("") }
    var whatsapp by remember { mutableStateOf("") }
    var note by remember { mutableStateOf("") }
    var paymentMethod by remember { mutableStateOf("A_COMBINAR") }
    var paymentStatus by remember { mutableStateOf("PENDENTE") }
    var methodOpen by remember { mutableStateOf(false) }
    var statusOpen by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        runCatching { productsRepository.list().filter { it.ativo && it.disponivel && it.availableStock > 0 } }
            .onSuccess { products = it }
            .onFailure { error = it.message ?: "Não foi possível carregar os produtos." }
        loading = false
    }

    val selectedItems = quantities.filterValues { it > 0 }
    val total = selectedItems.entries.sumOf { (id, qty) ->
        (products.firstOrNull { it.id == id }?.currentPriceCents ?: 0) * qty
    }

    WebModal(onDismiss = { if (!saving) onDismiss() }, maxWidth = 520) {
        WebModalHeader(
            kicker = "Pedidos",
            title = "Novo pedido",
            subtitle = "Registre uma venda manual usando o mesmo fluxo do painel web.",
            onClose = { if (!saving) onDismiss() }
        )

        Text("ITENS", color = web.muted, fontSize = 10.5.sp, fontWeight = FontWeight.Bold, letterSpacing = .4.sp)
        Spacer(Modifier.height(8.dp))

        if (loading) {
            Box(modifier = Modifier.fillMaxWidth().height(90.dp), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = web.accent, modifier = Modifier.size(22.dp), strokeWidth = 2.dp)
            }
        } else if (products.isEmpty()) {
            Surface(shape = RoundedCornerShape(10.dp), color = web.surfaceSoft, border = BorderStroke(1.dp, web.border)) {
                Text("Nenhum produto disponível para venda.", color = web.muted, fontSize = 11.5.sp, modifier = Modifier.padding(12.dp))
            }
        } else {
            Column {
                products.forEachIndexed { index, product ->
                    if (index > 0) HorizontalDivider(color = web.border)
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(product.nome, color = web.text, fontSize = 12.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text("${money(product.currentPriceCents)} · ${product.availableStock} em estoque", color = web.muted, fontSize = 10.sp, modifier = Modifier.padding(top = 2.dp))
                        }
                        QtyButton("−", enabled = (quantities[product.id] ?: 0) > 0) {
                            quantities[product.id] = ((quantities[product.id] ?: 0) - 1).coerceAtLeast(0)
                        }
                        Text((quantities[product.id] ?: 0).toString(), color = web.text, fontSize = 12.sp, fontWeight = FontWeight.Bold, modifier = Modifier.width(22.dp))
                        QtyButton("+", enabled = (quantities[product.id] ?: 0) < product.availableStock) {
                            quantities[product.id] = ((quantities[product.id] ?: 0) + 1).coerceAtMost(product.availableStock)
                        }
                    }
                }
            }
        }

        Surface(modifier = Modifier.fillMaxWidth().padding(top = 10.dp), shape = RoundedCornerShape(10.dp), color = web.surfaceSoft) {
            Row(modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("Total do pedido", color = web.muted, fontSize = 11.sp)
                Text(money(total), color = web.text, fontSize = 13.sp, fontWeight = FontWeight.Bold)
            }
        }

        Spacer(Modifier.height(18.dp))
        WebField("Cliente", customer, { customer = it.take(100) }, placeholder = "Nome da cliente")
        Spacer(Modifier.height(12.dp))
        WebField("WhatsApp", whatsapp, { whatsapp = it.take(24) }, placeholder = "(19) 99999-9999")
        Spacer(Modifier.height(12.dp))
        WebField("Observação", note, { note = it.take(500) }, placeholder = "Observações do pedido", singleLine = false, minHeight = 72)

        Spacer(Modifier.height(16.dp))
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            ManualSelect(
                label = "Pagamento",
                value = manualPaymentMethods.firstOrNull { it.first == paymentMethod }?.second ?: paymentMethod,
                expanded = methodOpen,
                onExpand = { methodOpen = true },
                onDismiss = { methodOpen = false },
                options = manualPaymentMethods,
                onSelect = { paymentMethod = it; methodOpen = false },
                modifier = Modifier.weight(1f)
            )
            ManualSelect(
                label = "Estado",
                value = manualPaymentStatuses.firstOrNull { it.first == paymentStatus }?.second ?: paymentStatus,
                expanded = statusOpen,
                onExpand = { statusOpen = true },
                onDismiss = { statusOpen = false },
                options = manualPaymentStatuses,
                onSelect = { paymentStatus = it; statusOpen = false },
                modifier = Modifier.weight(1f)
            )
        }

        if (error != null) {
            Text(error.orEmpty(), color = web.danger, fontSize = 11.5.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 14.dp))
        }

        Spacer(Modifier.height(14.dp))
        WebModalActions(
            primaryText = "Registrar pedido",
            onPrimary = {
                if (saving) return@WebModalActions
                error = when {
                    selectedItems.isEmpty() -> "Adicione pelo menos um produto."
                    customer.trim().isBlank() -> "Informe o nome da cliente."
                    else -> null
                }
                if (error != null) return@WebModalActions
                saving = true
                scope.launch {
                    runCatching {
                        ordersRepository.createManual(
                            ManualOrderInput(
                                itens = selectedItems.map { ManualOrderItemInput(it.key, it.value) },
                                customerName = customer.trim(),
                                customerWhatsapp = whatsapp.trim(),
                                observacao = note.trim(),
                                paymentMethod = paymentMethod,
                                paymentStatus = paymentStatus
                            )
                        )
                    }.onSuccess { id -> onCreated(id); onDismiss() }
                        .onFailure { error = it.message ?: "Não foi possível registrar o pedido." }
                    saving = false
                }
            },
            onSecondary = onDismiss,
            busy = saving
        )
    }
}

@Composable
private fun QtyButton(text: String, enabled: Boolean, onClick: () -> Unit) {
    val web = LocalRPWebColors.current
    Surface(
        onClick = onClick,
        enabled = enabled,
        modifier = Modifier.size(30.dp),
        shape = RoundedCornerShape(8.dp),
        color = web.surface,
        border = BorderStroke(1.dp, web.borderStrong)
    ) {
        Box(contentAlignment = Alignment.Center) { Text(text, color = if (enabled) web.accentDark else web.muted, fontSize = 15.sp, fontWeight = FontWeight.Bold) }
    }
}

@Composable
private fun ManualSelect(
    label: String,
    value: String,
    expanded: Boolean,
    onExpand: () -> Unit,
    onDismiss: () -> Unit,
    options: List<Pair<String, String>>,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    val web = LocalRPWebColors.current
    Column(modifier = modifier) {
        Text(label.uppercase(), color = web.muted, fontSize = 10.5.sp, fontWeight = FontWeight.Bold, letterSpacing = .4.sp)
        Spacer(Modifier.height(8.dp))
        Box {
            Surface(onClick = onExpand, modifier = Modifier.fillMaxWidth().height(40.dp), shape = RoundedCornerShape(9.dp), color = web.surface, border = BorderStroke(1.dp, web.borderStrong)) {
                Row(modifier = Modifier.fillMaxSize().padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                    Text(value, color = web.text, fontSize = 12.sp, maxLines = 1)
                    Icon(Icons.Outlined.KeyboardArrowDown, contentDescription = null, tint = web.muted, modifier = Modifier.size(18.dp))
                }
            }
            DropdownMenu(expanded = expanded, onDismissRequest = onDismiss) {
                options.forEach { (key, text) -> DropdownMenuItem(text = { Text(text) }, onClick = { onSelect(key) }) }
            }
        }
    }
}

private fun money(cents: Int): String = NumberFormat.getCurrencyInstance(Locale("pt", "BR")).format(cents / 100.0)
