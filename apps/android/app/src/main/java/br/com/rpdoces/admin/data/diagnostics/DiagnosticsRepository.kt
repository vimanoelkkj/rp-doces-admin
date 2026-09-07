package br.com.rpdoces.admin.data.diagnostics

import android.content.Context
import br.com.rpdoces.admin.data.dashboard.FlexibleBooleanSerializer
import br.com.rpdoces.admin.data.network.ApiClient
import br.com.rpdoces.admin.data.network.SessionCookieJar
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Query

@Serializable
data class DiagnosticPix(
    val diagnostico: Boolean = false,
    @SerialName("order_id") val orderId: String? = null,
    val status: String? = null,
    @SerialName("qr_code") val qrCode: String? = null,
    @SerialName("qr_code_base64") val qrCodeBase64: String? = null,
    @SerialName("ticket_url") val ticketUrl: String? = null,
    @SerialName("valor_centavos") val valueCents: Int = 10,
    val reembolsado: Boolean = false
)

@Serializable
data class DiagnosticProduct(
    val id: Int,
    val nome: String,
    val estoque: Int = 0,
    @SerialName("estoque_reservado") val reservedStock: Int = 0,
    @Serializable(with = FlexibleBooleanSerializer::class)
    val disponivel: Boolean = true,
    @Serializable(with = FlexibleBooleanSerializer::class)
    val ativo: Boolean = true
) {
    val availableStock: Int get() = (estoque - reservedStock).coerceAtLeast(0)
}

@Serializable
private data class ProductsPayload(
    val produtos: List<DiagnosticProduct> = emptyList()
)

@Serializable
private data class RefundRequest(
    @SerialName("order_id") val orderId: String
)

@Serializable
private data class TestOrderItem(
    @SerialName("produto_id") val productId: Int,
    val quantidade: Int
)

@Serializable
private data class TestOrderRequest(
    @SerialName("pedido_teste") val testOrder: Boolean = true,
    val itens: List<TestOrderItem>,
    @SerialName("metodo_pagamento") val paymentMethod: String = "A_COMBINAR",
    @SerialName("status_pagamento") val paymentStatus: String = "PENDENTE"
)

@Serializable
data class TestOrderResult(
    val ok: Boolean = false,
    val id: Int = 0
)

private interface DiagnosticsApi {
    @GET("api/admin/health/pix-real")
    suspend fun pix(
        @Query("latest") latest: Int? = null,
        @Query("order_id") orderId: String? = null
    ): Response<DiagnosticPix>

    @POST("api/admin/health/pix-real")
    suspend fun createPix(): Response<DiagnosticPix>

    @POST("api/admin/health/pix-real-refund")
    suspend fun refundPix(@Body body: RefundRequest): Response<DiagnosticPix>

    @GET("api/admin/products")
    suspend fun products(): Response<ProductsPayload>

    @POST("api/admin/orders")
    suspend fun createOrder(@Body body: TestOrderRequest): Response<TestOrderResult>
}

class DiagnosticsRepository(context: Context) {
    private val client = ApiClient(SessionCookieJar(context.applicationContext))
    private val api = client.retrofit.create(DiagnosticsApi::class.java)

    suspend fun latestPix(): DiagnosticPix = unwrap(
        api.pix(latest = 1),
        "Nao foi possivel carregar o ultimo Pix de diagnostico."
    )

    suspend fun getPix(orderId: String): DiagnosticPix = unwrap(
        api.pix(orderId = orderId),
        "Nao foi possivel consultar o Pix de diagnostico."
    )

    suspend fun createPix(): DiagnosticPix = unwrap(
        api.createPix(),
        "Nao foi possivel gerar o Pix de diagnostico."
    )

    suspend fun refundPix(orderId: String): DiagnosticPix = unwrap(
        api.refundPix(RefundRequest(orderId)),
        "Nao foi possivel reembolsar o Pix de diagnostico."
    )

    suspend fun products(): List<DiagnosticProduct> = unwrap(
        api.products(),
        "Nao foi possivel carregar os produtos para teste."
    ).produtos.filter { it.ativo && it.disponivel && it.availableStock > 0 }

    suspend fun createTestOrder(productId: Int, quantity: Int): TestOrderResult = unwrap(
        api.createOrder(
            TestOrderRequest(
                itens = listOf(TestOrderItem(productId = productId, quantidade = quantity.coerceAtLeast(1)))
            )
        ),
        "Nao foi possivel criar o pedido de teste."
    )

    private fun <T> unwrap(response: Response<T>, fallback: String): T {
        if (response.isSuccessful) {
            return response.body() ?: throw DiagnosticsException("Resposta invalida do servidor.", response.code())
        }

        val message = runCatching {
            val raw = response.errorBody()?.string().orEmpty()
            client.json.parseToJsonElement(raw).jsonObject["erro"]?.jsonPrimitive?.content
        }.getOrNull().orEmpty().ifBlank { fallback }

        throw DiagnosticsException(message, response.code())
    }
}

class DiagnosticsException(message: String, val status: Int? = null) : Exception(message)
