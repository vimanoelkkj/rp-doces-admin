package br.com.rpdoces.admin.data.store

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import retrofit2.Response
import retrofit2.Retrofit
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.PUT

@Serializable
data class StoreConfig(
    val whatsapp: String = "",
    @SerialName("local_retirada") val pickupLocation: String = "",
    val endereco: String = "",
    @SerialName("maps_url") val mapsUrl: String = "",
    @SerialName("entregas_status") val deliveryStatus: String = "EM_BREVE",
    @SerialName("horario_atendimento") val scheduleText: String = "",
    @SerialName("horario_dias") val scheduleDays: String = "",
    @SerialName("horario_abre") val opensAt: String = "10:00",
    @SerialName("horario_fecha") val closesAt: String = "19:00",
    @SerialName("mensagem_whatsapp") val whatsappMessage: String = "",
    @SerialName("home_hero_image_key") val heroImageKey: String = "",
    @SerialName("home_about_image_key") val aboutImageKey: String = ""
)

@Serializable
data class StoreUpdateInput(
    @SerialName("local_retirada") val pickupLocation: String,
    val endereco: String,
    @SerialName("maps_url") val mapsUrl: String,
    val whatsapp: String,
    @SerialName("mensagem_whatsapp") val whatsappMessage: String,
    @SerialName("horario_dias") val scheduleDays: String,
    @SerialName("horario_abre") val opensAt: String,
    @SerialName("horario_fecha") val closesAt: String,
    @SerialName("horario_atendimento") val scheduleText: String,
    @SerialName("entregas_status") val deliveryStatus: String
)

private interface StoreApi {
    @GET("api/admin/config")
    suspend fun get(): Response<StoreConfig>

    @PUT("api/admin/config")
    suspend fun update(@Body input: StoreUpdateInput): Response<JsonElement>
}

class StoreRepository(retrofit: Retrofit) {
    private val api = retrofit.create(StoreApi::class.java)

    suspend fun get(): StoreConfig {
        val response = api.get()
        if (!response.isSuccessful) throw StoreException("Não foi possível carregar as configurações da loja.", response.code())
        return response.body() ?: StoreConfig()
    }

    suspend fun update(input: StoreUpdateInput) {
        val response = api.update(input)
        if (!response.isSuccessful) throw StoreException("Não foi possível salvar as configurações da loja.", response.code())
    }
}

class StoreException(message: String, val status: Int? = null) : Exception(message)
