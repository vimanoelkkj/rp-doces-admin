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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
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
import br.com.rpdoces.admin.data.orders.OrderItem
import br.com.rpdoces.admin.ui.components.MotionChevron
import br.com.rpdoces.admin.ui.components.MotionDropdownMenu
import br.com.rpdoces.admin.ui.components.WebSelectorOption
import br.com.rpdoces.admin.ui.theme.LocalRPWebColors
import java.text.NumberFormat
import java.util.Locale

private val reallocationRefundMethods = listOf(
    "PIX_EXTERNO" to "Pix",
    "DINHEIRO" to "Dinheiro",
    "CARTAO" to "Cartão",
    "OUTRO" to "Outro meio"
)

@Composable
fun ReallocateOrderItemDialog(
    item: OrderItem,
    candidates: List<OrderItem>,
    busy: Boolean,
    error: String?,
    onDismiss: () -> Unit,
    onConfirm: (targetItemId: Int, refundMethod: String?, confirmRefund: Boolean) -> Unit
) {
    val web = LocalRPWebColors.current
    var selectedId by remember(item.id, candidates) { mutableStateOf(candidates.firstOrNull()?.id) }
    var selectorOpen by remember { mutableStateOf(false) }
    var refundMethod by remember(item.id) { mutableStateOf("PIX_EXTERNO") }
    var refundSelectorOpen by remember { mutableStateOf(false) }
    val target = candidates.firstOrNull { it.id == selectedId } ?: candidates.firstOrNull()
    val paid = item.paidCents
    val targetBalance = target?.balanceCents ?: 0
    val transferred = minOf(paid, targetBalance)
    val remaining = (targetBalance - transferred).coerceAtLeast(0)
    val refund = (paid - transferred).coerceAtLeast(0)

    Dialog(
        onDismissRequest = { if (!busy && !selectorOpen && !refundSelectorOpen) onDismiss() },
        properties = DialogProperties(usePlatformDefaultWidth = false)
    ) {
        Box(
            modifier = Modifier.fillMaxSize().padding(horizontal = 22.dp),
            contentAlignment = Alignment.Center
        ) {
            Surface(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(17.dp),
                color = web.surface,
                border = BorderStroke(1.dp, web.border)
            ) {
                Column(modifier = Modifier.padding(20.dp)) {
                    Text(
                        "CORRIGIR ITEM PAGO",
                        color = web.accentDark,
                        fontSize = 10.5.sp,
                        fontWeight = FontWeight.Bold
                    )
                    Text(
                        item.productName ?: "Produto",
                        color = web.text,
                        fontSize = 18.sp,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.padding(top = 7.dp)
                    )
                    Text(
                        "Este item recebeu ${reallocationMoney(paid)}, mas outro produto foi levado. Escolha qual item deve receber esse pagamento.",
                        color = web.muted,
                        fontSize = 11.5.sp,
                        lineHeight = 17.sp,
                        modifier = Modifier.padding(top = 8.dp)
                    )

                    Spacer(Modifier.height(17.dp))
                    Text(
                        "PRODUTO QUE A CLIENTE LEVOU",
                        color = web.muted,
                        fontSize = 10.sp,
                        fontWeight = FontWeight.Bold
                    )
                    Spacer(Modifier.height(6.dp))
                    Box {
                        Surface(
                            onClick = { if (!busy) selectorOpen = true },
                            enabled = !busy,
                            modifier = Modifier.fillMaxWidth().height(44.dp),
                            shape = RoundedCornerShape(9.dp),
                            color = web.surface,
                            border = BorderStroke(1.dp, web.borderStrong)
                        ) {
                            Row(
                                modifier = Modifier.fillMaxSize().padding(horizontal = 12.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.SpaceBetween
                            ) {
                                Text(
                                    target?.let { "${it.productName ?: "Produto"} · ${reallocationMoney(it.balanceCents)} pendente" }
                                        ?: "Nenhum item pendente",
                                    color = web.text,
                                    fontSize = 11.5.sp,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                    modifier = Modifier.weight(1f)
                                )
                                MotionChevron(
                                    expanded = selectorOpen,
                                    tint = web.muted,
                                    modifier = Modifier.size(18.dp)
                                )
                            }
                        }
                        MotionDropdownMenu(
                            expanded = selectorOpen,
                            onDismissRequest = { selectorOpen = false }
                        ) {
                            candidates.forEach { candidate ->
                                WebSelectorOption(
                                    text = "${candidate.productName ?: "Produto"} · ${reallocationMoney(candidate.balanceCents)} pendente",
                                    selected = candidate.id == selectedId,
                                    onClick = {
                                        selectedId = candidate.id
                                        selectorOpen = false
                                    }
                                )
                            }
                        }
                    }

                    if (target != null) {
                        Surface(
                            modifier = Modifier.fillMaxWidth().padding(top = 15.dp),
                            shape = RoundedCornerShape(12.dp),
                            color = if (refund > 0) web.orangeSoft else web.accentSoft,
                            border = BorderStroke(
                                1.dp,
                                if (refund > 0) web.tagOrangeText.copy(alpha = .30f) else web.accent.copy(alpha = .28f)
                            )
                        ) {
                            Column(
                                modifier = Modifier.padding(13.dp),
                                verticalArrangement = Arrangement.spacedBy(8.dp)
                            ) {
                                ReallocationPreviewLine(
                                    "Pagamento realocado",
                                    reallocationMoney(transferred),
                                    web.tagGreenText
                                )
                                if (remaining > 0) {
                                    ReallocationPreviewLine(
                                        "Ainda ficará pendente",
                                        reallocationMoney(remaining),
                                        web.tagOrangeText
                                    )
                                }
                                if (refund > 0) {
                                    ReallocationPreviewLine(
                                        "Diferença a devolver",
                                        reallocationMoney(refund),
                                        web.tagOrangeText
                                    )

                                    Spacer(Modifier.height(3.dp))
                                    Text(
                                        "FORMA DA DEVOLUÇÃO",
                                        color = web.muted,
                                        fontSize = 9.8.sp,
                                        fontWeight = FontWeight.Bold
                                    )
                                    Box {
                                        Surface(
                                            onClick = { if (!busy) refundSelectorOpen = true },
                                            enabled = !busy,
                                            modifier = Modifier.fillMaxWidth().height(40.dp),
                                            shape = RoundedCornerShape(9.dp),
                                            color = web.surface,
                                            border = BorderStroke(1.dp, web.borderStrong)
                                        ) {
                                            Row(
                                                modifier = Modifier.fillMaxSize().padding(horizontal = 11.dp),
                                                verticalAlignment = Alignment.CenterVertically,
                                                horizontalArrangement = Arrangement.SpaceBetween
                                            ) {
                                                Text(
                                                    reallocationRefundMethods.firstOrNull { it.first == refundMethod }?.second ?: refundMethod,
                                                    color = web.text,
                                                    fontSize = 11.sp
                                                )
                                                MotionChevron(
                                                    expanded = refundSelectorOpen,
                                                    tint = web.muted,
                                                    modifier = Modifier.size(17.dp)
                                                )
                                            }
                                        }
                                        MotionDropdownMenu(
                                            expanded = refundSelectorOpen,
                                            onDismissRequest = { refundSelectorOpen = false }
                                        ) {
                                            reallocationRefundMethods.forEach { (key, label) ->
                                                WebSelectorOption(
                                                    text = label,
                                                    selected = key == refundMethod,
                                                    onClick = {
                                                        refundMethod = key
                                                        refundSelectorOpen = false
                                                    }
                                                )
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }

                    Text(
                        if (refund > 0) {
                            "Ao confirmar, ${reallocationMoney(refund)} será registrado como devolvido. O produto antigo volta ao estoque quando já havia sido baixado, e o produto efetivamente levado assume a baixa física."
                        } else {
                            "Ao confirmar, o produto antigo sai da comanda. Se já tinha sido baixado, sua quantidade volta ao estoque. O produto escolhido passa a ser o efetivamente levado e recebe a baixa física."
                        },
                        color = web.muted,
                        fontSize = 10.8.sp,
                        lineHeight = 16.sp,
                        modifier = Modifier.padding(top = 13.dp)
                    )

                    if (!error.isNullOrBlank()) {
                        Text(
                            error,
                            color = web.danger,
                            fontSize = 11.sp,
                            fontWeight = FontWeight.SemiBold,
                            modifier = Modifier.padding(top = 12.dp)
                        )
                    }

                    Row(
                        modifier = Modifier.fillMaxWidth().padding(top = 19.dp),
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
                            onClick = {
                                val id = target?.id
                                if (!busy && id != null) {
                                    onConfirm(id, refundMethod.takeIf { refund > 0 }, refund > 0)
                                }
                            },
                            enabled = !busy && target?.id != null,
                            modifier = Modifier.weight(1.25f).height(42.dp),
                            shape = RoundedCornerShape(9.dp),
                            color = web.accent,
                            border = BorderStroke(1.dp, web.accentDark)
                        ) {
                            Box(contentAlignment = Alignment.Center) {
                                if (busy) {
                                    CircularProgressIndicator(
                                        modifier = Modifier.size(17.dp),
                                        strokeWidth = 2.dp,
                                        color = Color.White
                                    )
                                } else {
                                    Text(
                                        if (refund > 0) "Corrigir e devolver" else "Confirmar correção",
                                        color = Color.White,
                                        fontSize = 11.sp,
                                        fontWeight = FontWeight.Bold
                                    )
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
private fun ReallocationPreviewLine(label: String, value: String, valueColor: Color) {
    val web = LocalRPWebColors.current
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, color = web.muted, fontSize = 10.8.sp)
        Text(value, color = valueColor, fontSize = 11.sp, fontWeight = FontWeight.Bold)
    }
}

private fun reallocationMoney(cents: Int): String =
    NumberFormat.getCurrencyInstance(Locale("pt", "BR")).format(cents / 100.0)
