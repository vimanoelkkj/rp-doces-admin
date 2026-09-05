package br.com.rpdoces.admin.data.store

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.toRequestBody
import retrofit2.Response
import retrofit2.Retrofit
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.Multipart
import retrofit2.http.POST
import retrofit2.http.PUT
import retrofit2.http.Part
import retrofit2.http.Path

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

@Serializable
data class SiteImageResult(
    @SerialName("image_key") val imageKey: String,
    @SerialName("image_url") val imageUrl: String
)

@Serializable
private data class SiteImageResponse(
    val ok: Boolean = false,
    @SerialName("image_key") val imageKey: String = "",
    @SerialName("image_url") val imageUrl: String = ""
)

private interface StoreApi {
    @GET("api/admin/config")
    suspend fun get(): Response<StoreConfig>

    @PUT("api/admin/config")
    suspend fun update(@Body input: StoreUpdateInput): Response<JsonElement>

    @Multipart
    @POST("api/admin/site-images/{slot}")
    suspend fun uploadSiteImage(
        @Path("slot") slot: String,
        @Part image: MultipartBody.Part
    ): Response<SiteImageResponse>

    @DELETE("api/admin/site-images/{slot}")
    suspend fun removeSiteImage(@Path("slot") slot: String): Response<JsonElement>
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

    suspend fun uploadSiteImage(slot: String, bytes: ByteArray, fileName: String, mimeType: String): SiteImageResult {
        require(slot == "hero" || slot == "about") { "Slot de imagem inválido." }
        val body = bytes.toRequestBody(mimeType.toMediaType())
        val part = MultipartBody.Part.createFormData("image", fileName, body)
        val response = api.uploadSiteImage(slot, part)
        if (!response.isSuccessful) throw StoreException("Não foi possível enviar a imagem.", response.code())
        val payload = response.body() ?: throw StoreException("Resposta inválida ao enviar a imagem.", response.code())
        if (!payload.ok || payload.imageKey.isBlank()) throw StoreException("Não foi possível enviar a imagem.", response.code())
        return SiteImageResult(payload.imageKey, payload.imageUrl)
    }

    suspend fun removeSiteImage(slot: String) {
        require(slot == "hero" || slot == "about") { "Slot de imagem inválido." }
        val response = api.removeSiteImage(slot)
        if (!response.isSuccessful) throw StoreException("Não foi possível remover a imagem.", response.code())
    }
}

class StoreException(message: String, val status: Int? = null) : Exception(message)
