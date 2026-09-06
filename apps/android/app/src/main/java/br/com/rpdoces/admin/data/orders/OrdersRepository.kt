package br.com.rpdoces.admin.data.orders

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import retrofit2.Response
import retrofit2.Retrofit
import retrofit2.http.Body
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
    @SerialName("status_financeiro") val financialStatus: String? = null
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
private data class CancelCommandRequest(val acao: String = "CANCELAR_COMANDA")

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

    @POST("api/admin/orders/{id}/payments")
    suspend fun cancelCommand(@Path("id") id: Int, @Body body: CancelCommandRequest): Response<JsonElement>

    @POST("api/admin/orders")
    suspend fun createManual(@Body input: ManualOrderInput): Response<CreateManualOrderResponse>
}

class OrdersRepository(retrofit: Retrofit) {
    private val api = retrofit.create(OrdersApi::class.java)

    suspend fun list(): List<Order> = api.listFinancial().requireBody("Não foi possível carregar os pedidos.").pedidos

    suspend fun updateStatus(id: Int, status: String) {
        val response = if (status == "CANCELADO") {
            api.cancelCommand(id, CancelCommandRequest())
        } else {
            api.updateStatus(id, OrderStatusRequest(status))
        }
        response.requireSuccess("Não foi possível atualizar o pedido.")
    }

    suspend fun updatePayment(id: Int, status: String) {
        api.updatePayment(id, PaymentStatusRequest(status)).requireSuccess("Não foi possível atualizar o pagamento.")
    }

    suspend fun createManual(input: ManualOrderInput): Int = api.createManual(input)
        .requireBody("Não foi possível registrar o pedido manual.")
        .id
}

private fun <T> Response<T>.requireBody(message: String): T {
    if (!isSuccessful) throw OrdersException(message, code())
    return body() ?: throw OrdersException(message, code())
}

private fun Response<*>.requireSuccess(message: String) {
    if (!isSuccessful) throw OrdersException(message, code())
}

class OrdersException(message: String, val status: Int? = null) : Exception(message)
