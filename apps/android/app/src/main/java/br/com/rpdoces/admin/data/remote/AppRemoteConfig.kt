package br.com.rpdoces.admin.data.remote

import android.content.Context
import br.com.rpdoces.admin.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.Request

private const val SUPPORTED_SCHEMA_VERSION = 1
private const val PREFS_NAME = "rp_remote_config"
private const val KEY_CONFIG_JSON = "config_json"
private const val KEY_SAVED_AT = "saved_at"
private const val MIN_POLL_SECONDS = 3L
private const val MAX_POLL_SECONDS = 300L

@Serializable
data class AppRemoteConfig(
    @SerialName("schema_version") val schemaVersion: Int = 1,
    val revision: Int = 1,
    @SerialName("min_app_version_code") val minAppVersionCode: Int = 1,
    @SerialName("poll_seconds") val pollSeconds: Long = 5L,
    val theme: String = "system",
    @SerialName("dashboard_banner") val dashboardBanner: DashboardRemoteBanner = DashboardRemoteBanner()
)

@Serializable
data class DashboardRemoteBanner(
    val enabled: Boolean = false,
    val title: String = "",
    val message: String = ""
)

class AppRemoteConfigRepository(context: Context) {
    private val appContext = context.applicationContext
    private val preferences = appContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    private val client = OkHttpClient()
    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = false
    }

    /**
     * Retorna imediatamente a última configuração válida salva no aparelho.
     * Se o cache estiver ausente ou corrompido, cai nos defaults compilados no app.
     */
    fun cachedOrDefault(): AppRemoteConfig {
        val raw = preferences.getString(KEY_CONFIG_JSON, null) ?: return AppRemoteConfig()
        return runCatching { decodeAndValidate(raw) }
            .getOrElse {
                preferences.edit()
                    .remove(KEY_CONFIG_JSON)
                    .remove(KEY_SAVED_AT)
                    .apply()
                AppRemoteConfig()
            }
    }

    /**
     * Busca a configuração publicada, valida antes de aplicar e mantém o cache anterior
     * em caso de revisão regressiva. Falhas de rede/JSON nunca apagam uma configuração boa.
     */
    suspend fun fetch(): AppRemoteConfig = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url("${BuildConfig.API_ORIGIN}/app-config.json?t=${System.currentTimeMillis()}")
            .header("Cache-Control", "no-cache, no-store")
            .build()

        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                throw IllegalStateException("Remote config HTTP ${response.code}")
            }

            val body = response.body.string()
            val incoming = decodeAndValidate(body)
            val cached = cachedOrDefault()

            if (incoming.revision < cached.revision) {
                return@withContext cached
            }

            preferences.edit()
                .putString(KEY_CONFIG_JSON, body)
                .putLong(KEY_SAVED_AT, System.currentTimeMillis())
                .apply()

            incoming
        }
    }

    fun cachedAtMillis(): Long = preferences.getLong(KEY_SAVED_AT, 0L)

    private fun decodeAndValidate(raw: String): AppRemoteConfig {
        val decoded = json.decodeFromString<AppRemoteConfig>(raw)
        return validate(decoded)
    }

    private fun validate(config: AppRemoteConfig): AppRemoteConfig {
        require(config.schemaVersion in 1..SUPPORTED_SCHEMA_VERSION) {
            "Schema remoto não suportado: ${config.schemaVersion}"
        }
        require(config.revision >= 1) { "Revisão remota inválida." }
        require(config.minAppVersionCode <= BuildConfig.VERSION_CODE) {
            "Configuração exige app ${config.minAppVersionCode}; instalado ${BuildConfig.VERSION_CODE}."
        }
        require(config.pollSeconds in MIN_POLL_SECONDS..MAX_POLL_SECONDS) {
            "Intervalo de atualização remoto inválido."
        }

        val normalizedTheme = config.theme.trim().lowercase()
        require(normalizedTheme in setOf("system", "light", "dark")) {
            "Tema remoto inválido."
        }
        require(config.dashboardBanner.title.length <= 80) {
            "Título do banner remoto excede 80 caracteres."
        }
        require(config.dashboardBanner.message.length <= 280) {
            "Mensagem do banner remoto excede 280 caracteres."
        }

        return config.copy(theme = normalizedTheme)
    }
}
