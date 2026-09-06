package br.com.rpdoces.admin.data.admins

import br.com.rpdoces.admin.data.dashboard.FlexibleBooleanSerializer
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
data class AdminUser(
    val id: Int,
    val nome: String,
    val username: String,
    val email: String? = null,
    @Serializable(with = FlexibleBooleanSerializer::class)
    val ativo: Boolean = true,
    val papel: String = "ADMIN",
    @SerialName("criado_em") val createdAt: String? = null,
    @SerialName("avatar_key") val avatarKey: String? = null,
    @SerialName("avatar_url") val avatarUrl: String? = null
)

@Serializable
private data class AdminsResponse(val usuarios: List<AdminUser> = emptyList())

@Serializable
data class CreateAdminInput(
    val nome: String,
    val username: String,
    val email: String,
    val senha: String,
    val papel: String
)

@Serializable
private data class AdminActionRequest(
    val acao: String,
    val ativo: Boolean? = null,
    val papel: String? = null,
    val senha: String? = null
)

private interface AdminsApi {
    @GET("api/admin/users")
    suspend fun list(): Response<AdminsResponse>

    @POST("api/admin/users")
    suspend fun create(@Body input: CreateAdminInput): Response<JsonElement>

    @PUT("api/admin/users/{id}")
    suspend fun action(@Path("id") id: Int, @Body body: AdminActionRequest): Response<JsonElement>
}

class AdminsRepository(retrofit: Retrofit) {
    private val api = retrofit.create(AdminsApi::class.java)

    suspend fun list(): List<AdminUser> = api.list().requireBody("Não foi possível carregar os administradores.").usuarios

    suspend fun create(input: CreateAdminInput) {
        api.create(input).requireSuccess("Não foi possível criar o administrador.")
    }

    suspend fun setActive(id: Int, active: Boolean) {
        api.action(id, AdminActionRequest(acao = "toggle_ativo", ativo = active))
            .requireSuccess("Não foi possível alterar o estado da conta.")
    }

    suspend fun setRole(id: Int, role: String) {
        api.action(id, AdminActionRequest(acao = "alterar_papel", papel = role))
            .requireSuccess("Não foi possível alterar o nível de acesso.")
    }

    suspend fun resetPassword(id: Int, password: String) {
        api.action(id, AdminActionRequest(acao = "resetar_senha", senha = password))
            .requireSuccess("Não foi possível alterar a senha.")
    }
}

private fun <T> Response<T>.requireBody(message: String): T {
    if (!isSuccessful) throw AdminsException(message, code())
    return body() ?: throw AdminsException(message, code())
}

private fun Response<*>.requireSuccess(message: String) {
    if (!isSuccessful) throw AdminsException(message, code())
}

class AdminsException(message: String, val status: Int? = null) : Exception(message)
