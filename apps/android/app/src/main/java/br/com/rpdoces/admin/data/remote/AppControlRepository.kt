package br.com.rpdoces.admin.data.remote

import android.content.Context
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
import retrofit2.http.PUT

@Serializable
data class AppConfigHistoryEntry(
    val revision: Int,
    @SerialName("atualizado_em") val updatedAt: String? = null,
    @SerialName("atualizado_por") val updatedBy: Int? = null,
    @SerialName("atualizado_por_nome") val updatedByName: String? = null,
    val config: AppRemoteConfig
)

@Serializable
data class AppControlPayload(
    val config: AppRemoteConfig,
    val history: List<AppConfigHistoryEntry> = emptyList()
)

@Serializable
private data class RestoreConfigRequest(
    @SerialName("restore_revision") val revision: Int
)

private interface AppControlApi {
    @GET("api/admin/app-config")
    suspend fun load(): Response<AppControlPayload>

    @PUT("api/admin/app-config")
    suspend fun save(@Body config: AppRemoteConfig): Response<AppControlPayload>

    @POST("api/admin/app-config")
    suspend fun restore(@Body body: RestoreConfigRequest): Response<AppControlPayload>
}

class AppControlRepository(context: Context) {
    private val client = ApiClient(SessionCookieJar(context.applicationContext))
    private val api = client.retrofit.create(AppControlApi::class.java)

    suspend fun load(): AppControlPayload = unwrap(
        response = api.load(),
        fallback = "Não foi possível carregar o controle do app."
    )

    suspend fun save(config: AppRemoteConfig): AppControlPayload = unwrap(
        response = api.save(config),
        fallback = "Não foi possível publicar a configuração."
    )

    suspend fun restore(revision: Int): AppControlPayload = unwrap(
        response = api.restore(RestoreConfigRequest(revision)),
        fallback = "Não foi possível restaurar a revisão."
    )

    private fun unwrap(response: Response<AppControlPayload>, fallback: String): AppControlPayload {
        if (response.isSuccessful) {
            return response.body() ?: throw AppControlException("Resposta inválida do servidor.", response.code())
        }

        val message = runCatching {
            val raw = response.errorBody()?.string().orEmpty()
            client.json.parseToJsonElement(raw).jsonObject["erro"]?.jsonPrimitive?.content
        }.getOrNull().orEmpty().ifBlank { fallback }

        throw AppControlException(message, response.code())
    }
}

class AppControlException(message: String, val status: Int? = null) : Exception(message)
