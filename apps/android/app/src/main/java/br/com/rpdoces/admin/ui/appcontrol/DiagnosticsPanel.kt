package br.com.rpdoces.admin.ui.appcontrol

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import br.com.rpdoces.admin.data.diagnostics.DiagnosticPix
import br.com.rpdoces.admin.data.diagnostics.DiagnosticProduct
import br.com.rpdoces.admin.data.diagnostics.DiagnosticsRepository
import br.com.rpdoces.admin.ui.components.MotionChevron
import br.com.rpdoces.admin.ui.components.MotionDropdownMenu
import br.com.rpdoces.admin.ui.components.WebSelectorOption
import br.com.rpdoces.admin.ui.theme.LocalRPWebColors
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@Composable
fun DiagnosticsPanel() {
    val web = LocalRPWebColors.current
    val context = LocalContext.current
    val clipboard = LocalClipboardManager.current
    val scope = rememberCoroutineScope()
    val repository = remember(context) { DiagnosticsRepository(context) }

    var products by remember { mutableStateOf<List<DiagnosticProduct>>(emptyList()) }
    var productId by remember { mutableStateOf<Int?>(null) }
    var quantity by remember { mutableStateOf(1) }
    var pix by remember { mutableStateOf<DiagnosticPix?>(null) }
    var pixBusy by remember { mutableStateOf(false) }
    var orderBusy by remember { mutableStateOf(false) }
    var pixMessage by remember { mutableStateOf("Aguardando teste") }
    var orderMessage by remember { mutableStateOf("") }
    var confirmAction by remember { mutableStateOf<String?>(null) }

    val selected = products.firstOrNull { it.id == productId }
    val maxQuantity = selected?.availableStock?.coerceAtLeast(1) ?: 1

    suspend fun reloadProducts() {
        runCatching { repository.products() }
            .onSuccess { loaded ->
                products = loaded
                if (productId == null || loaded.none { it.id == productId }) {
                    productId = loaded.firstOrNull()?.id
                    quantity = 1
                }
            }
            .onFailure { orderMessage = it.message ?: "Nao foi possivel carregar os produtos para teste." }
    }

    LaunchedEffect(Unit) {
        reloadProducts()
        runCatching { repository.latestPix() }
            .onSuccess { value ->
                if (value.diagnostico) {
                    pix = value
                    pixMessage = when (value.status?.uppercase()) {
                        "PAGO" -> "Ultimo Pix confirmado"
                        "REEMBOLSADO" -> "Ultimo Pix reembolsado"
                        null -> "Aguardando teste"
                        else -> "Ultimo teste: ${value.status.lowercase()}"
                    }
                }
            }
    }

    LaunchedEffect(pix?.orderId, pix?.status) {
        val orderId = pix?.orderId ?: return@LaunchedEffect
        if (pix?.status?.uppercase() != "PENDENTE") return@LaunchedEffect
        while (true) {
            delay(3_000)
            val value = runCatching { repository.getPix(orderId) }.getOrNull() ?: continue
            pix = value
            val state = value.status?.uppercase().orEmpty()
            pixMessage = if (state == "PAGO") "Pagamento confirmado pelo Mercado Pago" else "Status: ${state.lowercase()}"
            if (state != "PENDENTE") break
        }
    }

    fun runConfirmed() {
        val action = confirmAction ?: return
        confirmAction = null
        when (action) {
            "PIX" -> {
                if (pixBusy) return
                pixBusy = true
                pixMessage = "Gerando cobranca real..."
                scope.launch {
                    runCatching { repository.createPix() }
                        .onSuccess {
                            pix = it
                            pixMessage = "Pix gerado. Aguardando pagamento..."
                        }
                        .onFailure { pixMessage = it.message ?: "Nao foi possivel gerar o Pix de teste." }
                    pixBusy = false
                }
            }
            "REFUND" -> {
                val orderId = pix?.orderId ?: return
                if (pixBusy) return
                pixBusy = true
                pixMessage = "Solicitando reembolso..."
                scope.launch {
                    runCatching { repository.refundPix(orderId) }
                        .onSuccess { result ->
                            pix = pix?.copy(
                                status = if (result.reembolsado) "REEMBOLSADO" else result.status ?: pix?.status,
                                reembolsado = result.reembolsado
                            ) ?: result
                            pixMessage = if (result.reembolsado) "Pix reembolsado" else "Reembolso em processamento..."
                        }
                        .onFailure { pixMessage = it.message ?: "Nao foi possivel reembolsar o Pix." }
                    pixBusy = false
                }
            }
            "ORDER" -> {
                val product = selected ?: return
                if (orderBusy) return
                val safeQuantity = quantity.coerceIn(1, product.availableStock.coerceAtLeast(1))
                orderBusy = true
                orderMessage = "Criando pedido de teste..."
                scope.launch {
                    runCatching { repository.createTestOrder(product.id, safeQuantity) }
                        .onSuccess {
                            orderMessage = "Pedido de teste #${it.id} criado. Abra Pedidos para exercitar a comanda."
                            reloadProducts()
                        }
                        .onFailure { orderMessage = it.message ?: "Nao foi possivel criar o pedido de teste." }
                    orderBusy = false
                }
            }
        }
    }

    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(14.dp),
        color = web.surface,
        border = BorderStroke(1.dp, web.border)
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.Top,
                horizontalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text("DIAGNOSTICOS PERMANENTES", color = web.accentDark, fontSize = 9.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = .5.sp)
                    Text("Testes operacionais", color = web.text, fontSize = 15.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 3.dp))
                    Text("Valide Pix, estoque e fluxo de pedido sem contaminar o faturamento.", color = web.muted, fontSize = 10.sp, lineHeight = 14.sp, modifier = Modifier.padding(top = 3.dp))
                }
                DiagnosticBadge("OWNER", web.accentSoft, web.accentDark)
            }

            DiagnosticCard(
                title = "Pix real de diagnostico",
                subtitle = "Gera R$ 0,10 fora dos pedidos e do faturamento.",
                badge = "REAL",
                badgeBackground = web.orangeSoft,
                badgeText = web.tagOrangeText
            ) {
                DiagnosticStatus(pixMessage)

                if (!pix?.qrCode.isNullOrBlank()) {
                    Surface(
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(9.dp),
                        color = web.appBackground,
                        border = BorderStroke(1.dp, web.border)
                    ) {
                        Column(modifier = Modifier.padding(10.dp)) {
                            Text("Pix copia e cola", color = web.muted, fontSize = 9.sp, fontWeight = FontWeight.SemiBold)
                            Text(
                                pix?.qrCode.orEmpty(),
                                color = web.text,
                                fontSize = 9.5.sp,
                                lineHeight = 13.sp,
                                maxLines = 4,
                                overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.padding(top = 5.dp)
                            )
                            Spacer(Modifier.height(8.dp))
                            DiagnosticButton(
                                text = "Copiar codigo",
                                enabled = !pix?.qrCode.isNullOrBlank(),
                                primary = false,
                                onClick = {
                                    clipboard.setText(AnnotatedString(pix?.qrCode.orEmpty()))
                                    pixMessage = "Codigo Pix copiado"
                                }
                            )
                        }
                    }
                }

                DiagnosticButton(
                    text = if (pixBusy) "Processando..." else "Gerar Pix de R$ 0,10",
                    enabled = !pixBusy,
                    primary = true,
                    onClick = { confirmAction = "PIX" }
                )

                if (pix?.orderId != null) {
                    DiagnosticButton(
                        text = "Consultar agora",
                        enabled = !pixBusy,
                        primary = false,
                        onClick = {
                            val orderId = pix?.orderId ?: return@DiagnosticButton
                            pixBusy = true
                            scope.launch {
                                runCatching { repository.getPix(orderId) }
                                    .onSuccess {
                                        pix = it
                                        pixMessage = "Status: ${it.status?.lowercase() ?: "desconhecido"}"
                                    }
                                    .onFailure { pixMessage = it.message ?: "Nao foi possivel consultar o Pix." }
                                pixBusy = false
                            }
                        }
                    )
                }

                if (pix?.status?.uppercase() == "PAGO") {
                    DiagnosticButton(
                        text = "Reembolsar teste",
                        enabled = !pixBusy,
                        primary = false,
                        danger = true,
                        onClick = { confirmAction = "REFUND" }
                    )
                }
            }

            DiagnosticCard(
                title = "Pedido de produto de teste",
                subtitle = "Cria uma comanda real de teste para troca, pagamento, reabertura e estoque.",
                badge = "TESTE",
                badgeBackground = web.greenSoft,
                badgeText = web.tagGreenText
            ) {
                DiagnosticProductSelector(
                    products = products,
                    selectedId = productId,
                    onSelected = {
                        productId = it
                        quantity = 1
                    }
                )

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Text("Quantidade", color = web.muted, fontSize = 9.5.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                    QuantityButton("-", enabled = quantity > 1) { quantity = (quantity - 1).coerceAtLeast(1) }
                    Text(quantity.toString(), color = web.text, fontSize = 12.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(horizontal = 5.dp))
                    QuantityButton("+", enabled = selected != null && quantity < maxQuantity) { quantity = (quantity + 1).coerceAtMost(maxQuantity) }
                }

                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(9.dp),
                    color = web.accentSoft.copy(alpha = .45f)
                ) {
                    Text(
                        "Usa estoque real para o teste ser fiel. O pedido e marcado como diagnostico e fica fora das metricas de venda.",
                        color = web.muted,
                        fontSize = 9.5.sp,
                        lineHeight = 13.sp,
                        modifier = Modifier.padding(10.dp)
                    )
                }

                if (orderMessage.isNotBlank()) DiagnosticStatus(orderMessage)

                DiagnosticButton(
                    text = if (orderBusy) "Criando..." else "Criar pedido de teste",
                    enabled = !orderBusy && selected != null,
                    primary = true,
                    onClick = { confirmAction = "ORDER" }
                )
            }

            if (confirmAction != null) {
                val message = when (confirmAction) {
                    "PIX" -> "Este teste cria um Pix REAL de R$ 0,10. Continuar?"
                    "REFUND" -> "Solicitar o reembolso REAL deste Pix de diagnostico?"
                    else -> {
                        val product = selected
                        "Criar pedido de teste com ${quantity}x ${product?.nome ?: "produto"}? O estoque real sera reservado."
                    }
                }
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(10.dp),
                    color = web.orangeSoft.copy(alpha = .55f),
                    border = BorderStroke(1.dp, web.tagOrangeText.copy(alpha = .25f))
                ) {
                    Column(modifier = Modifier.padding(11.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
                        Text(message, color = web.text, fontSize = 10.5.sp, lineHeight = 14.sp, fontWeight = FontWeight.SemiBold)
                        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Box(modifier = Modifier.weight(1f)) {
                                DiagnosticButton("Cancelar", true, false) { confirmAction = null }
                            }
                            Box(modifier = Modifier.weight(1f)) {
                                DiagnosticButton("Confirmar", true, true, onClick = ::runConfirmed)
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun DiagnosticCard(
    title: String,
    subtitle: String,
    badge: String,
    badgeBackground: Color,
    badgeText: Color,
    content: @Composable ColumnScope.() -> Unit
) {
    val web = LocalRPWebColors.current
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(11.dp),
        color = web.appBackground,
        border = BorderStroke(1.dp, web.border)
    ) {
        Column(modifier = Modifier.padding(11.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(title, color = web.text, fontSize = 11.5.sp, fontWeight = FontWeight.Bold)
                    Text(subtitle, color = web.muted, fontSize = 9.5.sp, lineHeight = 13.sp, modifier = Modifier.padding(top = 2.dp))
                }
                DiagnosticBadge(badge, badgeBackground, badgeText)
            }
            content()
        }
    }
}

@Composable
private fun DiagnosticBadge(text: String, background: Color, foreground: Color) {
    Surface(shape = RoundedCornerShape(99.dp), color = background) {
        Text(text, color = foreground, fontSize = 8.5.sp, fontWeight = FontWeight.ExtraBold, modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp))
    }
}

@Composable
private fun DiagnosticStatus(text: String) {
    val web = LocalRPWebColors.current
    Surface(modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(8.dp), color = web.surface) {
        Text(text, color = web.muted, fontSize = 9.5.sp, lineHeight = 13.sp, modifier = Modifier.padding(9.dp))
    }
}

@Composable
private fun DiagnosticButton(
    text: String,
    enabled: Boolean,
    primary: Boolean,
    danger: Boolean = false,
    onClick: () -> Unit
) {
    val web = LocalRPWebColors.current
    val background = when {
        primary -> web.accent
        danger -> web.orangeSoft
        else -> web.surface
    }
    val foreground = when {
        !enabled -> web.muted.copy(alpha = .45f)
        primary -> Color.White
        danger -> web.danger
        else -> web.text
    }
    Surface(
        onClick = onClick,
        enabled = enabled,
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(9.dp),
        color = background,
        border = BorderStroke(1.dp, if (primary) web.accentDark else if (danger) web.danger.copy(alpha = .25f) else web.borderStrong)
    ) {
        Box(modifier = Modifier.height(36.dp), contentAlignment = Alignment.Center) {
            Text(text, color = foreground, fontSize = 10.5.sp, fontWeight = FontWeight.Bold)
        }
    }
}

@Composable
private fun DiagnosticProductSelector(
    products: List<DiagnosticProduct>,
    selectedId: Int?,
    onSelected: (Int) -> Unit
) {
    val web = LocalRPWebColors.current
    var open by remember { mutableStateOf(false) }
    val selected = products.firstOrNull { it.id == selectedId }

    Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
        Text("Produto", color = web.muted, fontSize = 9.5.sp, fontWeight = FontWeight.SemiBold)
        Box {
            Surface(
                onClick = { if (products.isNotEmpty()) open = true },
                enabled = products.isNotEmpty(),
                modifier = Modifier.fillMaxWidth().height(40.dp),
                shape = RoundedCornerShape(9.dp),
                color = web.surface,
                border = BorderStroke(1.dp, web.borderStrong)
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 11.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Text(
                        selected?.let { "${it.nome} · ${it.availableStock} disp." } ?: "Nenhum produto disponivel",
                        color = if (selected != null) web.text else web.muted,
                        fontSize = 10.5.sp,
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f)
                    )
                    MotionChevron(expanded = open, tint = web.muted, modifier = Modifier.size(16.dp))
                }
            }
            MotionDropdownMenu(expanded = open, onDismissRequest = { open = false }) {
                products.forEach { product ->
                    WebSelectorOption(
                        text = "${product.nome} · ${product.availableStock} disp.",
                        selected = product.id == selectedId,
                        onClick = {
                            onSelected(product.id)
                            open = false
                        }
                    )
                }
            }
        }
    }
}

@Composable
private fun QuantityButton(text: String, enabled: Boolean, onClick: () -> Unit) {
    val web = LocalRPWebColors.current
    Surface(
        onClick = onClick,
        enabled = enabled,
        modifier = Modifier.size(32.dp),
        shape = RoundedCornerShape(8.dp),
        color = web.surface,
        border = BorderStroke(1.dp, web.borderStrong)
    ) {
        Box(contentAlignment = Alignment.Center) {
            Text(text, color = if (enabled) web.text else web.muted.copy(alpha = .35f), fontSize = 16.sp, fontWeight = FontWeight.Bold)
        }
    }
}
