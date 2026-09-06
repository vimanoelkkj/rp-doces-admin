package br.com.rpdoces.admin.ui.orders

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
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
import br.com.rpdoces.admin.data.orders.Order
import br.com.rpdoces.admin.data.orders.OrderItem
import br.com.rpdoces.admin.data.orders.OrdersRepository
import br.com.rpdoces.admin.data.products.Product
import br.com.rpdoces.admin.data.products.ProductsRepository
import br.com.rpdoces.admin.ui.components.MotionChevron
import br.com.rpdoces.admin.ui.components.MotionDropdownMenu
import br.com.rpdoces.admin.ui.components.MotionValue
import br.com.rpdoces.admin.ui.components.WebModal
import br.com.rpdoces.admin.ui.components.WebModalActions
import br.com.rpdoces.admin.ui.components.WebModalHeader
import br.com.rpdoces.admin.ui.components.WebSelectorOption
import br.com.rpdoces.admin.ui.theme.LocalRPWebColors
import java.text.NumberFormat
import java.util.Locale
import kotlinx.coroutines.launch

private val refundMethodOptions = listOf(
    "PIX_EXTERNO" to "Pix",
    "DINHEIRO" to "Dinheiro",
    "CARTAO" to "Cartão",
    "OUTRO" to "Outro meio"
)

@Composable
internal fun EditOrderItemDialog(
    order: Order,
    item: OrderItem,
    ordersRepository: OrdersRepository,
    productsRepository: ProductsRepository,
    onDismiss: () -> Unit,
    onSaved: () -> Unit
) {
    val web = LocalRPWebColors.current
    val scope = rememberCoroutineScope()
    var products by remember(item.id) { mutableStateOf<List<Product>>(emptyList()) }
    var selectedProductId by remember(item.id) { mutableStateOf(item.productId ?: 0) }
    var quantity by remember(item.id) { mutableStateOf(item.quantidade.coerceAtLeast(1)) }
    var productOpen by remember { mutableStateOf(false) }
    var refundMethod by remember(item.id) { mutableStateOf(defaultRefundMethod(order.paymentMethod)) }
    var refundMethodOpen by remember { mutableStateOf(false) }
    var loading by remember(item.id) { mutableStateOf(true) }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(item.id) {
        loading = true
        runCatching {
            productsRepository.list().filter { product ->
                product.ativo && (product.id == item.productId || product.availableStock > 0)
            }
        }.onSuccess { loaded ->
            products = loaded
            if (loaded.none { it.id == selectedProductId }) {
                selectedProductId = loaded.firstOrNull()?.id ?: 0
                quantity = 1
            }
        }.onFailure {
            error = it.message ?: "Não foi possível carregar os produtos."
        }
        loading = false
    }

    val selectedProduct = products.firstOrNull { it.id == selectedProductId }
    val sameProduct = selectedProductId == item.productId
    val maxQuantity = selectedProduct?.let { product ->
        (product.availableStock + if (sameProduct) item.quantidade else 0).coerceIn(1, 50)
    } ?: 50
    val unitCents = if (sameProduct) item.unitCents else selectedProduct?.currentPriceCents ?: 0
    val previewTotal = unitCents * quantity
    val paidExchange = item.paidCents > 0
    val refundCents = if (paidExchange) (item.paidCents - previewTotal).coerceAtLeast(0) else 0
    val pendingAfterExchange = if (paidExchange) (previewTotal - item.paidCents).coerceAtLeast(0) else 0

    WebModal(onDismiss = { if (!saving) onDismiss() }, maxWidth = 500) {
        WebModalHeader(
            kicker = "Pedido #${order.id}",
            title = "Trocar produto",
            subtitle = "${item.quantidade}x ${item.productName ?: "Produto"}",
            onClose = { if (!saving) onDismiss() }
        )

        Text(
            "ITEM DO PEDIDO",
            color = web.muted,
            fontSize = 10.5.sp,
            fontWeight = FontWeight.Bold,
            letterSpacing = .4.sp
        )
        Spacer(Modifier.height(8.dp))

        if (loading) {
            Box(
                modifier = Modifier.fillMaxWidth().height(90.dp),
                contentAlignment = Alignment.Center
            ) {
                CircularProgressIndicator(
                    color = web.accent,
                    modifier = Modifier.size(22.dp),
                    strokeWidth = 2.dp
                )
            }
        } else if (products.isEmpty()) {
            Surface(
                shape = RoundedCornerShape(10.dp),
                color = web.surfaceSoft,
                border = BorderStroke(1.dp, web.border)
            ) {
                Text(
                    "Nenhum produto disponível para esta troca.",
                    color = web.muted,
                    fontSize = 11.5.sp,
                    modifier = Modifier.padding(12.dp)
                )
            }
        } else {
            EditItemProductSelect(
                selectedId = selectedProductId,
                selectedLabel = selectedProduct?.let {
                    "${it.nome} · ${money(it.currentPriceCents)} · ${it.availableStock} disp."
                }.orEmpty(),
                expanded = productOpen,
                onExpand = { productOpen = true },
                onDismiss = { productOpen = false },
                products = products,
                onSelect = { productId ->
                    selectedProductId = productId
                    quantity = 1
                    productOpen = false
                }
            )

            Spacer(Modifier.height(14.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text("QUANTIDADE", color = web.muted, fontSize = 10.5.sp, fontWeight = FontWeight.Bold, letterSpacing = .4.sp)
                    Text(
                        "Máximo disponível: $maxQuantity",
                        color = web.muted,
                        fontSize = 10.sp,
                        modifier = Modifier.padding(top = 3.dp)
                    )
                }
                EditItemQuantityStepper(
                    quantity = quantity,
                    max = maxQuantity,
                    onDecrease = { quantity = (quantity - 1).coerceAtLeast(1) },
                    onIncrease = { quantity = (quantity + 1).coerceAtMost(maxQuantity) }
                )
            }

            Surface(
                modifier = Modifier.fillMaxWidth().padding(top = 16.dp),
                shape = RoundedCornerShape(10.dp),
                color = web.surfaceSoft,
                border = BorderStroke(1.dp, web.border)
            ) {
                Column(modifier = Modifier.padding(horizontal = 12.dp, vertical = 11.dp)) {
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text("Antes", color = web.muted, fontSize = 10.5.sp)
                        Text(
                            "${item.quantidade}x ${item.productName ?: "Produto"}",
                            color = web.text,
                            fontSize = 10.5.sp,
                            fontWeight = FontWeight.SemiBold,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                    }
                    Spacer(Modifier.height(8.dp))
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text("Novo total do item", color = web.muted, fontSize = 11.sp)
                        MotionValue(targetState = money(previewTotal)) { total ->
                            Text(total, color = web.text, fontSize = 13.sp, fontWeight = FontWeight.Bold)
                        }
                    }
                }
            }

            if (paidExchange) {
                Surface(
                    modifier = Modifier.fillMaxWidth().padding(top = 14.dp),
                    shape = RoundedCornerShape(10.dp),
                    color = if (refundCents > 0) web.orangeSoft else web.surfaceSoft,
                    border = BorderStroke(1.dp, if (refundCents > 0) web.tagOrangeText.copy(alpha = .35f) else web.border)
                ) {
                    Column(modifier = Modifier.padding(12.dp)) {
                        Text("AJUSTE DO PAGAMENTO", color = web.muted, fontSize = 10.5.sp, fontWeight = FontWeight.Bold, letterSpacing = .4.sp)
                        Spacer(Modifier.height(8.dp))
                        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text("Valor já pago", color = web.muted, fontSize = 11.sp)
                            Text(money(item.paidCents), color = web.text, fontSize = 11.5.sp, fontWeight = FontWeight.Bold)
                        }
                        Spacer(Modifier.height(7.dp))
                        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text(if (refundCents > 0) "Diferença a devolver" else "Saldo após a troca", color = web.muted, fontSize = 11.sp)
                            Text(
                                when {
                                    refundCents > 0 -> money(refundCents)
                                    pendingAfterExchange > 0 -> "${money(pendingAfterExchange)} pendente"
                                    else -> "Quitado"
                                },
                                color = if (refundCents > 0) web.tagOrangeText else web.text,
                                fontSize = 11.5.sp,
                                fontWeight = FontWeight.Bold
                            )
                        }

                        if (refundCents > 0) {
                            Spacer(Modifier.height(12.dp))
                            RefundMethodSelect(
                                selectedKey = refundMethod,
                                expanded = refundMethodOpen,
                                onExpand = { refundMethodOpen = true },
                                onDismiss = { refundMethodOpen = false },
                                onSelect = {
                                    refundMethod = it
                                    refundMethodOpen = false
                                }
                            )
                        }
                    }
                }
            }

            Text(
                when {
                    refundCents > 0 -> "Ao confirmar, ${money(refundCents)} será registrado como devolvido. O produto original volta ao estoque e o novo assume a baixa ou reserva correspondente."
                    paidExchange -> "O pagamento já registrado será preservado no novo produto. Se ele for mais caro, somente a diferença ficará pendente."
                    else -> "Se o valor mudar, a comanda recalcula automaticamente o saldo."
                },
                color = web.muted,
                fontSize = 10.5.sp,
                lineHeight = 15.sp,
                modifier = Modifier.padding(top = 12.dp)
            )
        }

        if (error != null) {
            Text(
                error.orEmpty(),
                color = web.danger,
                fontSize = 11.5.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.padding(top = 14.dp)
            )
        }

        Spacer(Modifier.height(14.dp))
        WebModalActions(
            primaryText = if (refundCents > 0) "Trocar e devolver ${money(refundCents)}" else "Salvar troca",
            onPrimary = {
                if (saving) return@WebModalActions
                val itemId = item.id
                val product = selectedProduct
                error = when {
                    itemId == null -> "Este item não possui identificador para edição."
                    product == null -> "Selecione um produto válido."
                    quantity !in 1..maxQuantity -> "Quantidade indisponível para este produto."
                    else -> null
                }
                if (error != null || itemId == null || product == null) return@WebModalActions

                saving = true
                scope.launch {
                    runCatching {
                        if (paidExchange) {
                            ordersRepository.exchangePaidItem(
                                id = order.id,
                                itemId = itemId,
                                productId = product.id,
                                quantity = quantity,
                                refundMethod = refundMethod.takeIf { refundCents > 0 },
                                confirmRefund = refundCents > 0
                            )
                        } else {
                            ordersRepository.updateItem(
                                id = order.id,
                                itemId = itemId,
                                productId = product.id,
                                quantity = quantity
                            )
                        }
                    }.onSuccess {
                        onSaved()
                        onDismiss()
                    }.onFailure {
                        error = it.message ?: "Não foi possível alterar o item do pedido."
                    }
                    saving = false
                }
            },
            onSecondary = onDismiss,
            busy = saving
        )
    }
}

@Composable
private fun RefundMethodSelect(
    selectedKey: String,
    expanded: Boolean,
    onExpand: () -> Unit,
    onDismiss: () -> Unit,
    onSelect: (String) -> Unit
) {
    val web = LocalRPWebColors.current
    Column {
        Text("FORMA DA DEVOLUÇÃO", color = web.muted, fontSize = 10.5.sp, fontWeight = FontWeight.Bold, letterSpacing = .4.sp)
        Spacer(Modifier.height(8.dp))
        Box {
            Surface(
                onClick = onExpand,
                modifier = Modifier.fillMaxWidth().height(42.dp),
                shape = RoundedCornerShape(9.dp),
                color = web.surface,
                border = BorderStroke(1.dp, web.borderStrong)
            ) {
                Row(
                    modifier = Modifier.fillMaxSize().padding(horizontal = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Text(refundMethodOptions.firstOrNull { it.first == selectedKey }?.second ?: selectedKey, color = web.text, fontSize = 11.5.sp)
                    MotionChevron(expanded = expanded, tint = web.muted, modifier = Modifier.size(18.dp))
                }
            }
            MotionDropdownMenu(expanded = expanded, onDismissRequest = onDismiss) {
                refundMethodOptions.forEach { (key, label) ->
                    WebSelectorOption(text = label, selected = key == selectedKey, onClick = { onSelect(key) })
                }
            }
        }
    }
}

@Composable
private fun EditItemProductSelect(
    selectedId: Int,
    selectedLabel: String,
    expanded: Boolean,
    onExpand: () -> Unit,
    onDismiss: () -> Unit,
    products: List<Product>,
    onSelect: (Int) -> Unit
) {
    val web = LocalRPWebColors.current
    Column {
        Text("PRODUTO", color = web.muted, fontSize = 10.5.sp, fontWeight = FontWeight.Bold, letterSpacing = .4.sp)
        Spacer(Modifier.height(8.dp))
        Box {
            Surface(
                onClick = onExpand,
                modifier = Modifier.fillMaxWidth().height(42.dp),
                shape = RoundedCornerShape(9.dp),
                color = web.surface,
                border = BorderStroke(1.dp, web.borderStrong)
            ) {
                Row(
                    modifier = Modifier.fillMaxSize().padding(horizontal = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    MotionValue(targetState = selectedLabel, modifier = Modifier.weight(1f)) { value ->
                        Text(value, color = web.text, fontSize = 11.5.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    MotionChevron(expanded = expanded, tint = web.muted, modifier = Modifier.size(18.dp))
                }
            }
            MotionDropdownMenu(expanded = expanded, onDismissRequest = onDismiss) {
                products.forEach { product ->
                    WebSelectorOption(
                        text = "${product.nome} · ${money(product.currentPriceCents)} · ${product.availableStock} disp.",
                        selected = product.id == selectedId,
                        onClick = { onSelect(product.id) }
                    )
                }
            }
        }
    }
}

@Composable
private fun EditItemQuantityStepper(
    quantity: Int,
    max: Int,
    onDecrease: () -> Unit,
    onIncrease: () -> Unit
) {
    val web = LocalRPWebColors.current
    Surface(
        modifier = Modifier.width(112.dp).height(38.dp),
        shape = RoundedCornerShape(10.dp),
        color = web.surface,
        border = BorderStroke(1.dp, web.borderStrong)
    ) {
        Row(modifier = Modifier.fillMaxSize(), verticalAlignment = Alignment.CenterVertically) {
            EditItemStepButton("−", quantity > 1, onDecrease)
            Surface(modifier = Modifier.width(1.dp).height(20.dp), color = web.border) {}
            Box(modifier = Modifier.weight(1f), contentAlignment = Alignment.Center) {
                MotionValue(targetState = quantity) { value ->
                    Text(value.toString(), color = web.text, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                }
            }
            Surface(modifier = Modifier.width(1.dp).height(20.dp), color = web.border) {}
            EditItemStepButton("+", quantity < max, onIncrease)
        }
    }
}

@Composable
private fun EditItemStepButton(text: String, enabled: Boolean, onClick: () -> Unit) {
    val web = LocalRPWebColors.current
    Surface(
        onClick = onClick,
        enabled = enabled,
        modifier = Modifier.width(36.dp).height(38.dp),
        color = Color.Transparent
    ) {
        Box(contentAlignment = Alignment.Center) {
            Text(
                text,
                color = if (enabled) web.accentDark else web.muted.copy(alpha = .5f),
                fontSize = 15.sp,
                fontWeight = FontWeight.Bold
            )
        }
    }
}

private fun defaultRefundMethod(value: String?): String {
    val method = value.orEmpty().uppercase()
    return when {
        "DINHEIRO" in method -> "DINHEIRO"
        "CART" in method -> "CARTAO"
        "PIX" in method -> "PIX_EXTERNO"
        else -> "OUTRO"
    }
}

private fun money(cents: Int): String = NumberFormat.getCurrencyInstance(Locale("pt", "BR")).format(cents / 100.0)
