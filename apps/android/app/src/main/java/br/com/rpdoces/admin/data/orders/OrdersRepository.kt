package br.com.rpdoces.admin.data.orders

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import retrofit2.Response
import retrofit2.Retrofit
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.PUT
import retrofit2.http.Path

@Serializable
data class OrderItem(
    val id: Int? = null,
    @SerialName("produto_id") val productId: Int? = null,
    @SerialName("produto_nome") val productName: String? = null,
    val quantidade: Int = 0,
    @SerialName("valor_unitario_centavos") val unitCents: Int = 0,
    @SerialName("valor_total_centavos") val totalCents: Int = 0,
    @SerialName("valor_pago_centavos") val paidCents: Int = 0,
    @SerialName("saldo_centavos") val balanceCents: Int = 0,
    @SerialName("status_financeiro") val financialStatus: String? = null,
    @SerialName("estoque_baixado_em") val stockDeductedAt: String? = null
)

@Serializable
data class Order(
    val id: Int,
    @SerialName("cliente_nome") val customerName: String? = null,
    @SerialName("cliente_email") val customerEmail: String? = null,
    @SerialName("cliente_whatsapp") val customerWhatsapp: String? = null,
    @SerialName("tipo_entrega") val deliveryType: String? = null,
    @SerialName("observacao") val note: String? = null,
    @SerialName("metodo_pagamento") val paymentMethod: String? = null,
    @SerialName("status_pagamento") val paymentStatus: String? = "PENDENTE",
    @SerialName("status_financeiro") val financialStatus: String? = null,
    @SerialName("status_pedido") val orderStatus: String? = "NOVO",
    @SerialName("status_comanda") val commandStatus: String? = null,
    @SerialName("valor_total_centavos") val totalCents: Int = 0,
    @SerialName("valor_pago_centavos") val paidCents: Int = 0,
    @SerialName("saldo_centavos") val balanceCents: Int = 0,
    @SerialName("criado_em") val createdAt: String? = null,
    @SerialName("atualizado_em") val updatedAt: String? = null,
    @SerialName("pago_em") val paidAt: String? = null,
    val itens: List<OrderItem> = emptyList()
)

@Serializable
private data class OrdersResponse(val pedidos: List<Order> = emptyList())

@Serializable
private data class OrderStatusRequest(@SerialName("status_pedido") val status: String)

@Serializable
private data class PaymentStatusRequest(@SerialName("status_pagamento") val status: String)

@Serializable
private data class CancelCommandRequest(
    val acao: String = "CANCELAR_COMANDA",
    val confirmacao: String = "CANCELAR"
)

@Serializable
private data class RegisterPaymentRequest(
    val acao: String = "REGISTRAR",
    val metodo: String,
    @SerialName("valor_centavos") val valueCents: Int,
    @SerialName("pix_pendente") val pixDecision: String = "CANCELAR"
)

@Serializable
data class OrderItemUpdateInput(
    @SerialName("item_id") val itemId: Int,
    @SerialName("produto_id") val productId: Int,
    val quantidade: Int
)

@Serializable
private data class PaidOrderItemExchangeInput(
    @SerialName("produto_id") val productId: Int,
    val quantidade: Int,
    @SerialName("devolucao_metodo") val refundMethod: String? = null,
    @SerialName("confirmacao_devolucao") val refundConfirmation: String? = null
)

@Serializable
private data class OrderItemReallocationInput(
    @SerialName("destino_item_id") val targetItemId: Int,
    @SerialName("devolucao_metodo") val refundMethod: String? = null,
    @SerialName("confirmacao_devolucao") val refundConfirmation: String? = null
)

@Serializable
data class ManualOrderItemInput(
    @SerialName("produto_id") val productId: Int,
    val quantidade: Int
)

@Serializable
data class ManualOrderInput(
    val itens: List<ManualOrderItemInput>,
    @SerialName("cliente_nome") val customerName: String,
    @SerialName("cliente_whatsapp") val customerWhatsapp: String,
    val observacao: String,
    @SerialName("metodo_pagamento") val paymentMethod: String,
    @SerialName("status_pagamento") val paymentStatus: String
)

@Serializable
private data class CreateManualOrderResponse(val ok: Boolean = false, val id: Int = 0)

private interface OrdersApi {
    @GET("api/admin/orders/finance")
    suspend fun listFinancial(): Response<OrdersResponse>

    @PUT("api/admin/orders/{id}")
    suspend fun updateStatus(@Path("id") id: Int, @Body body: OrderStatusRequest): Response<JsonElement>

    @PUT("api/admin/orders/{id}")
    suspend fun updatePayment(@Path("id") id: Int, @Body body: PaymentStatusRequest): Response<JsonElement>

    @PUT("api/admin/orders/{id}/items")
    suspend fun updateItem(@Path("id") id: Int, @Body body: OrderItemUpdateInput): Response<JsonElement>

    @POST("api/admin/orders/{id}/items/{itemId}/exchange")
    suspend fun exchangePaidItem(
        @Path("id") id: Int,
        @Path("itemId") itemId: Int,
        @Body body: PaidOrderItemExchangeInput
    ): Response<JsonElement>

    @DELETE("api/admin/orders/{id}/items/{itemId}")
    suspend fun deleteItem(@Path("id") id: Int, @Path("itemId") itemId: Int): Response<JsonElement>

    @POST("api/admin/orders/{id}/items/{itemId}/reallocate")
    suspend fun reallocateItemPayment(
        @Path("id") id: Int,
        @Path("itemId") itemId: Int,
        @Body body: OrderItemReallocationInput
    ): Response<JsonElement>

    @POST("api/admin/orders/{id}/payments")
    suspend fun registerPayment(
        @Path("id") id: Int,
        @Body body: RegisterPaymentRequest
    ): Response<JsonElement>

    @POST("api/admin/orders/{id}/payments")
    suspend fun cancelCommand(@Path("id") id: Int, @Body body: CancelCommandRequest): Response<JsonElement>

    @POST("api/admin/orders/{id}/reopen")
    suspend fun reopenPaidCommand(@Path("id") id: Int): Response<JsonElement>

    @POST("api/admin/orders")
    suspend fun createManual(@Body input: ManualOrderInput): Response<CreateManualOrderResponse>
}

class OrdersRepository(retrofit: Retrofit) {
    private val api = retrofit.create(OrdersApi::class.java)

    suspend fun list(): List<Order> = api.listFinancial().requireBody("Não foi possível carregar os pedidos.").pedidos

    suspend fun updateStatus(id: Int, status: String) {
        val normalized = status.uppercase()
        if (normalized == "CANCELADO") {
            throw OrdersException(
                "Cancelamento exige confirmação explícita. Use a ação de cancelar pedido.",
                409
            )
        }
        api.updateStatus(id, OrderStatusRequest(normalized))
            .requireSuccess("Não foi possível atualizar o pedido.")
    }

    suspend fun cancelOrder(id: Int) {
        api.cancelCommand(id, CancelCommandRequest())
            .requireSuccess("Não foi possível cancelar a comanda.")
    }

    suspend fun reopenPaidCommand(id: Int) {
        api.reopenPaidCommand(id)
            .requireSuccess("Não foi possível reabrir a comanda paga.")
    }

    suspend fun updatePayment(id: Int, status: String) {
        val normalized = status.uppercase()
        if (normalized == "CANCELADO") {
            throw OrdersException(
                "O pagamento não pode ser cancelado pelo seletor. Use o fluxo de cancelamento da comanda.",
                409
            )
        }

        val direct = api.updatePayment(id, PaymentStatusRequest(normalized))
        if (direct.isSuccessful) return

        val directMessage = direct.apiErrorMessage("Não foi possível atualizar o pagamento.")
        val isFinancialOrder = direct.code() == 400 && directMessage.contains("Alteração de pagamento inválida", ignoreCase = true)
        if (normalized != "PAGO" || !isFinancialOrder) {
            throw OrdersException(directMessage, direct.code())
        }

        val order = list().firstOrNull { it.id == id }
            ?: throw OrdersException("Pedido não encontrado ao atualizar o financeiro.", 404)
        if (order.balanceCents <= 0 || order.financialStatus.equals("PAGO", ignoreCase = true)) return

        val method = manualFinancialMethod(order.paymentMethod)
            ?: throw OrdersException(
                "Não foi possível identificar a forma de pagamento desta comanda. Registre o pagamento pela tela financeira.",
                400
            )

        val payment = api.registerPayment(
            id,
            RegisterPaymentRequest(
                metodo = method,
                valueCents = order.balanceCents,
                pixDecision = "CANCELAR"
            )
        )
        if (payment.isSuccessful) return

        val refreshed = runCatching { list().firstOrNull { it.id == id } }.getOrNull()
        if (refreshed != null && (refreshed.balanceCents <= 0 || refreshed.financialStatus.equals("PAGO", ignoreCase = true))) {
            return
        }

        throw OrdersException(
            payment.apiErrorMessage("Não foi possível registrar a quitação da comanda."),
            payment.code()
        )
    }

    suspend fun updateItem(id: Int, itemId: Int, productId: Int, quantity: Int) {
        api.updateItem(
            id,
            OrderItemUpdateInput(itemId = itemId, productId = productId, quantidade = quantity)
        ).requireSuccess("Não foi possível alterar o item do pedido.")
    }

    suspend fun exchangePaidItem(
        id: Int,
        itemId: Int,
        productId: Int,
        quantity: Int,
        refundMethod: String? = null,
        confirmRefund: Boolean = false
    ) {
        api.exchangePaidItem(
            id,
            itemId,
            PaidOrderItemExchangeInput(
                productId = productId,
                quantidade = quantity,
                refundMethod = refundMethod,
                refundConfirmation = if (confirmRefund) "DEVOLVIDO" else null
            )
        ).requireSuccess("Não foi possível trocar o item pago.")
    }

    suspend fun deleteItem(id: Int, itemId: Int) {
        api.deleteItem(id, itemId).requireSuccess("Não foi possível excluir o item da comanda.")
    }

    suspend fun reallocateItemPayment(
        id: Int,
        itemId: Int,
        targetItemId: Int,
        refundMethod: String? = null,
        confirmRefund: Boolean = false
    ) {
        api.reallocateItemPayment(
            id,
            itemId,
            OrderItemReallocationInput(
                targetItemId = targetItemId,
                refundMethod = refundMethod,
                refundConfirmation = if (confirmRefund) "DEVOLVIDO" else null
            )
        ).requireSuccess("Não foi possível corrigir o produto pago da comanda.")
    }

    suspend fun createManual(input: ManualOrderInput): Int = api.createManual(input)
        .requireBody("Não foi possível registrar o pedido manual.")
        .id
}

private fun manualFinancialMethod(value: String?): String? {
    val method = value.orEmpty().uppercase()
    return when {
        "PIX" in method -> "PIX_EXTERNO"
        "CART" in method -> "CARTAO"
        "DINHEIRO" in method -> "DINHEIRO"
        else -> null
    }
}

private fun Response<*>.apiErrorMessage(fallback: String): String {
    val raw = runCatching { errorBody()?.string().orEmpty() }.getOrDefault("")
    if (raw.isBlank()) return fallback
    return runCatching {
        Json.parseToJsonElement(raw)
            .jsonObject["erro"]
            ?.jsonPrimitive
            ?.contentOrNull
            ?.takeIf { it.isNotBlank() }
    }.getOrNull() ?: fallback
}

private fun <T> Response<T>.requireBody(message: String): T {
    if (!isSuccessful) throw OrdersException(apiErrorMessage(message), code())
    return body() ?: throw OrdersException(message, code())
}

private fun Response<*>.requireSuccess(message: String) {
    if (!isSuccessful) throw OrdersException(apiErrorMessage(message), code())
}

class OrdersException(message: String, val status: Int? = null) : Exception(message)
