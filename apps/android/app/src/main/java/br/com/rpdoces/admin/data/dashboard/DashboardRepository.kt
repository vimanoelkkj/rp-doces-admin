package br.com.rpdoces.admin.data.dashboard

import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.intOrNull
import retrofit2.Response
import retrofit2.Retrofit
import retrofit2.http.GET

@Serializable
data class DashboardOrderItem(
    val id: Int? = null,
    @SerialName("produto_id") val productId: Int? = null,
    @SerialName("produto_nome") val productName: String? = null,
    val quantidade: Int = 0
)

@Serializable
data class DashboardOrder(
    val id: Int,
    @SerialName("cliente_nome") val customerName: String? = null,
    @SerialName("produto_id") val productId: Int? = null,
    @SerialName("produto_nome") val productName: String? = null,
    val quantidade: Int = 0,
    @SerialName("valor_total_centavos") val totalCents: Int = 0,
    @SerialName("saldo_centavos") val balanceCents: Int = 0,
    @SerialName("status_pagamento") val paymentStatus: String? = "PENDENTE",
    @SerialName("status_financeiro") val financialStatus: String? = null,
    @SerialName("status_pedido") val orderStatus: String? = "NOVO",
    @SerialName("status_comanda") val commandStatus: String? = null,
    @SerialName("criado_em") val createdAt: String? = null,
    @SerialName("atualizado_em") val updatedAt: String? = null,
    @SerialName("pago_em") val paidAt: String? = null,
    val itens: List<DashboardOrderItem> = emptyList()
)

@Serializable
data class DashboardProduct(
    val id: Int,
    val nome: String,
    val categoria: String? = null,
    @SerialName("categoria_nome") val categoryName: String? = null,
    @Serializable(with = FlexibleBooleanSerializer::class)
    val ativo: Boolean = true,
    val estoque: Int = 0,
    @SerialName("estoque_reservado") val reservedStock: Int = 0
)

@Serializable
private data class FinancialOrdersResponse(
    val pedidos: List<DashboardOrder> = emptyList()
)

@Serializable
private data class ProductsResponse(
    val produtos: List<DashboardProduct> = emptyList()
)

private interface DashboardApi {
    @GET("api/admin/orders")
    suspend fun reconcileOrders(): Response<JsonElement>

    @GET("api/admin/orders/finance")
    suspend fun financialOrders(): Response<FinancialOrdersResponse>

    @GET("api/admin/products")
    suspend fun products(): Response<ProductsResponse>
}

data class DashboardSnapshot(
    val paidRevenueTodayCents: Int,
    val paidTodayCount: Int,
    val ordersTodayCount: Int,
    val pendingPaymentCount: Int,
    val waitingPreparationCount: Int,
    val productCount: Int,
    val soldOutCount: Int,
    val lowStockCount: Int,
    val recentOrders: List<DashboardOrder>,
    val attention: List<String>,
    val orders: List<DashboardOrder>,
    val products: List<DashboardProduct>
)

class DashboardRepository(retrofit: Retrofit) {
    private val api = retrofit.create(DashboardApi::class.java)

    suspend fun load(): DashboardSnapshot = coroutineScope {
        val reconciliation = api.reconcileOrders()
        if (!reconciliation.isSuccessful) {
            throw DashboardException("Não foi possível atualizar os pedidos.", reconciliation.code())
        }

        val ordersRequest = async { api.financialOrders() }
        val productsRequest = async { api.products() }
        val ordersResponse = ordersRequest.await()
        val productsResponse = productsRequest.await()

        if (!ordersResponse.isSuccessful) {
            throw DashboardException("Não foi possível carregar o financeiro.", ordersResponse.code())
        }
        if (!productsResponse.isSuccessful) {
            throw DashboardException("Não foi possível carregar os produtos.", productsResponse.code())
        }

        buildSnapshot(
            orders = ordersResponse.body()?.pedidos.orEmpty(),
            products = productsResponse.body()?.produtos.orEmpty()
        )
    }
}

class DashboardException(message: String, val status: Int? = null) : Exception(message)

fun buildSnapshot(
    orders: List<DashboardOrder>,
    products: List<DashboardProduct>,
    now: Instant = Instant.now(),
    zoneId: ZoneId = ZoneId.systemDefault()
): DashboardSnapshot {
    val today = now.atZone(zoneId).toLocalDate()

    val ordersToday = orders.filter { sameDay(it.createdAt, today, zoneId) }
    val paidToday = orders.filter {
        effectivePaymentStatus(it) == "PAGO" &&
            sameDay(it.paidAt ?: it.updatedAt, today, zoneId)
    }
    val pendingPayment = orders.filter {
        effectivePaymentStatus(it) in setOf("PENDENTE", "PARCIAL")
    }
    val waitingPreparation = orders.filter {
        it.orderStatus.equals("NOVO", ignoreCase = true) && effectivePaymentStatus(it) == "PAGO"
    }
    val soldOut = products.filter { it.ativo && availableStock(it) <= 0 }
    val lowStock = products.filter {
        val available = availableStock(it)
        it.ativo && available in 1..2
    }

    val attention = buildList {
        if (pendingPayment.isNotEmpty()) {
            add("${pendingPayment.size} ${plural(pendingPayment.size, "pedido aguardando pagamento", "pedidos aguardando pagamento")}")
        }
        if (waitingPreparation.isNotEmpty()) {
            add("${waitingPreparation.size} ${plural(waitingPreparation.size, "pedido aguardando preparação", "pedidos aguardando preparação")}")
        }
        if (soldOut.isNotEmpty()) {
            add("${soldOut.size} ${plural(soldOut.size, "produto sem estoque disponível", "produtos sem estoque disponível")}")
        }
        if (lowStock.isNotEmpty()) {
            add("${lowStock.size} ${plural(lowStock.size, "produto com estoque baixo", "produtos com estoque baixo")}")
        }
    }

    return DashboardSnapshot(
        paidRevenueTodayCents = paidToday.sumOf { it.totalCents },
        paidTodayCount = paidToday.size,
        ordersTodayCount = ordersToday.size,
        pendingPaymentCount = pendingPayment.size,
        waitingPreparationCount = waitingPreparation.size,
        productCount = products.size,
        soldOutCount = soldOut.size,
        lowStockCount = lowStock.size,
        recentOrders = orders.take(6),
        attention = attention,
        orders = orders,
        products = products
    )
}

fun effectivePaymentStatus(order: DashboardOrder): String =
    (order.financialStatus ?: order.paymentStatus ?: "PENDENTE").uppercase()

fun availableStock(product: DashboardProduct): Int = product.estoque - product.reservedStock

fun dashboardParseInstant(value: String?): Instant? {
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

private fun plural(value: Int, singular: String, plural: String): String = if (value == 1) singular else plural

private fun sameDay(value: String?, expected: LocalDate, zoneId: ZoneId): Boolean {
    val instant = dashboardParseInstant(value) ?: return false
    return instant.atZone(zoneId).toLocalDate() == expected
}

object FlexibleBooleanSerializer : KSerializer<Boolean> {
    override val descriptor: SerialDescriptor = PrimitiveSerialDescriptor("FlexibleBoolean", PrimitiveKind.BOOLEAN)

    override fun deserialize(decoder: Decoder): Boolean {
        val jsonDecoder = decoder as? JsonDecoder ?: return decoder.decodeBoolean()
        val primitive = jsonDecoder.decodeJsonElement() as? JsonPrimitive ?: return false
        return primitive.booleanOrNull ?: (primitive.intOrNull == 1)
    }

    override fun serialize(encoder: Encoder, value: Boolean) {
        encoder.encodeBoolean(value)
    }
}
