package br.com.rpdoces.admin.data.auth

import br.com.rpdoces.admin.data.network.SessionCookieJar
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST

@Serializable
data class AuthUser(
    val id: Int,
    val nome: String,
    val username: String,
    val email: String? = null,
    val ativo: Int = 1,
    val papel: String = "ADMIN",
    @SerialName("avatar_key") val avatarKey: String? = null,
    @SerialName("avatar_url") val avatarUrl: String? = null
)

@Serializable
data class IdentifiedUser(
    val nome: String,
    val username: String,
    @SerialName("avatar_url") val avatarUrl: String? = null
)

@Serializable
private data class IdentifyRequest(val username: String)

@Serializable
private data class IdentifyResponse(
    val encontrado: Boolean,
    val usuario: IdentifiedUser? = null
)

@Serializable
private data class LoginRequest(
    val username: String,
    val senha: String
)

@Serializable
private data class LoginResponse(
    val ok: Boolean,
    val usuario: LoginUser
)

@Serializable
private data class LoginUser(
    val id: Int,
    val nome: String,
    val username: String,
    val email: String? = null
)

@Serializable
private data class MeResponse(
    val autenticado: Boolean,
    val usuario: AuthUser? = null
)

@Serializable
private data class ApiError(
    val erro: String? = null
)

private interface AuthApi {
    @POST("api/auth/identify")
    suspend fun identify(@Body body: IdentifyRequest): Response<IdentifyResponse>

    @POST("api/auth/login")
    suspend fun login(@Body body: LoginRequest): Response<LoginResponse>

    @GET("api/auth/me")
    suspend fun me(): Response<MeResponse>

    @POST("api/auth/logout")
    suspend fun logout(): Response<Unit>
}

class AuthException(message: String, val status: Int? = null) : Exception(message)

class AuthRepository(
    retrofit: retrofit2.Retrofit,
    private val json: Json,
    private val cookieJar: SessionCookieJar
) {
    private val api = retrofit.create(AuthApi::class.java)

    suspend fun restoreSession(): AuthUser? {
        val response = api.me()
        if (response.code() == 401) {
            cookieJar.clear()
            return null
        }
        if (!response.isSuccessful) throw error(response, "Não foi possível verificar a sessão.")
        return response.body()?.takeIf { it.autenticado }?.usuario
    }

    suspend fun identify(username: String): IdentifiedUser? {
        val normalized = username.trim().lowercase()
        if (normalized.isBlank()) throw AuthException("Informe seu usuário.")
        val response = api.identify(IdentifyRequest(normalized))
        if (!response.isSuccessful) throw error(response, "Não foi possível localizar a conta.")
        val body = response.body() ?: throw AuthException("Resposta inválida do servidor.", response.code())
        return body.usuario?.takeIf { body.encontrado }
    }

    suspend fun login(username: String, password: String): AuthUser {
        val normalized = username.trim().lowercase()
        if (normalized.isBlank() || password.isBlank()) {
            throw AuthException("Informe usuário e senha.")
        }

        val login = api.login(LoginRequest(normalized, password))
        if (!login.isSuccessful) throw error(login, "Não foi possível entrar.")

        return restoreSession()
            ?: throw AuthException("A sessão foi criada, mas não foi possível carregar a conta.")
    }

    suspend fun logout() {
        try {
            api.logout()
        } finally {
            cookieJar.clear()
        }
    }

    private fun error(response: Response<*>, fallback: String): AuthException {
        val message = runCatching {
            val raw = response.errorBody()?.string().orEmpty()
            json.decodeFromString<ApiError>(raw).erro
        }.getOrNull().orEmpty().ifBlank { fallback }
        return AuthException(message, response.code())
    }
}
