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
private const val KEY_ETAG = "etag"
private const val MIN_POLL_SECONDS = 10L
private const val MAX_POLL_SECONDS = 300L

private val allowedDashboardSections = setOf(
    "metrics",
    "flavors",
    "receivables",
    "recent_orders",
    "attention"
)

@Serializable
data class AppRemoteConfig(
    @SerialName("schema_version") val schemaVersion: Int = 1,
    val revision: Int = 1,
    @SerialName("min_app_version_code") val minAppVersionCode: Int = 1,
    @SerialName("poll_seconds") val pollSeconds: Long = 30L,
    val theme: String = "system",
    val maintenance: RemoteMaintenance = RemoteMaintenance(),
    val update: RemoteUpdate = RemoteUpdate(),
    val navigation: RemoteNavigation = RemoteNavigation(),
    @SerialName("dashboard_banner") val dashboardBanner: DashboardRemoteBanner = DashboardRemoteBanner(),
    val features: RemoteFeatureFlags = RemoteFeatureFlags(),
    @SerialName("dashboard_section_order") val dashboardSectionOrder: List<String> = listOf(
        "metrics",
        "flavors",
        "receivables",
        "recent_orders",
        "attention"
    )
)

@Serializable
data class RemoteMaintenance(
    val enabled: Boolean = false,
    val eyebrow: String = "MANUTENÇÃO",
    val title: String = "Voltamos em instantes",
    val message: String = "O painel está temporariamente indisponível enquanto fazemos um ajuste."
)

@Serializable
data class RemoteUpdate(
    val eyebrow: String = "ATUALIZAÇÃO NECESSÁRIA",
    val title: String = "Atualize o R&P Doces",
    val message: String = "Há uma versão mais recente do aplicativo disponível.",
    val url: String = ""
)

@Serializable
data class RemoteNavigation(
    val dashboard: Boolean = true,
    val products: Boolean = true,
    val orders: Boolean = true,
    val admins: Boolean = true,
    val store: Boolean = true
) {
    fun isVisible(key: String): Boolean = when (key) {
        "dashboard" -> dashboard
        "products" -> products
        "orders" -> orders
        "admins" -> admins
        "store" -> store
        else -> false
    }

    fun hasAnyVisible(): Boolean = dashboard || products || orders || admins || store
}

@Serializable
data class DashboardRemoteBanner(
    val enabled: Boolean = false,
    val eyebrow: String = "AVISO",
    val title: String = "",
    val message: String = "",
    val tone: String = "accent"
)

@Serializable
data class RemoteFeatureFlags(
    @SerialName("dashboard_metrics") val dashboardMetrics: Boolean = true,
    @SerialName("dashboard_flavors") val dashboardFlavors: Boolean = true,
    @SerialName("dashboard_receivables") val dashboardReceivables: Boolean = true,
    @SerialName("dashboard_recent_orders") val dashboardRecentOrders: Boolean = true,
    @SerialName("dashboard_attention") val dashboardAttention: Boolean = true,
    @SerialName("orders_manual_create") val ordersManualCreate: Boolean = true,
    @SerialName("paid_order_notifications") val paidOrderNotifications: Boolean = true
)

class AppRemoteConfigRepository(context: Context) {
    private val appContext = context.applicationContext
    private val preferences = appContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    private val client = OkHttpClient()
    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = false
    }
    private val apiOrigin = BuildConfig.API_ORIGIN.trimEnd('/')

    /**
     * Retorna imediatamente a última configuração válida salva no aparelho.
     * Se o cache estiver ausente ou corrompido, cai nos defaults compilados no app.
     */
    fun cachedOrDefault(): AppRemoteConfig {
        val raw = preferences.getString(KEY_CONFIG_JSON, null) ?: return AppRemoteConfig()
        return runCatching { decodeAndValidate(raw) }
            .getOrElse {
                clearInvalidCache()
                AppRemoteConfig()
            }
    }

    /**
     * A fonte principal é /api/app-config, servida pelo D1 e validada no servidor.
     * ETag evita transferir o JSON novamente quando nada mudou. Enquanto versões antigas
     * ainda existem em produção, o arquivo estático continua sendo um fallback seguro.
     */
    suspend fun fetch(): AppRemoteConfig = withContext(Dispatchers.IO) {
        val cached = cachedOrDefault()
        runCatching { fetchDynamic(cached) }
            .getOrElse { fetchLegacyStatic(cached) }
    }

    fun cachedAtMillis(): Long = preferences.getLong(KEY_SAVED_AT, 0L)

    private fun fetchDynamic(cached: AppRemoteConfig): AppRemoteConfig {
        val builder = Request.Builder()
            .url("$apiOrigin/api/app-config")
            .header("Cache-Control", "no-cache")

        preferences.getString(KEY_ETAG, null)
            ?.takeIf { it.isNotBlank() }
            ?.let { builder.header("If-None-Match", it) }

        client.newCall(builder.build()).execute().use { response ->
            if (response.code == 304) {
                touchCache()
                return cached
            }
            if (!response.isSuccessful) {
                throw IllegalStateException("Remote config HTTP ${response.code}")
            }

            val body = response.body.string()
            val incoming = decodeAndValidate(body)
            if (incoming.revision < cached.revision) return cached

            persist(
                body = body,
                etag = response.header("ETag")
            )
            return incoming
        }
    }

    private fun fetchLegacyStatic(cached: AppRemoteConfig): AppRemoteConfig {
        val request = Request.Builder()
            .url("$apiOrigin/app-config.json?t=${System.currentTimeMillis()}")
            .header("Cache-Control", "no-cache, no-store")
            .build()

        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                throw IllegalStateException("Remote config fallback HTTP ${response.code}")
            }

            val body = response.body.string()
            val incoming = decodeAndValidate(body)
            if (incoming.revision < cached.revision) return cached

            persist(body = body, etag = null)
            return incoming
        }
    }

    private fun persist(body: String, etag: String?) {
        preferences.edit()
            .putString(KEY_CONFIG_JSON, body)
            .putLong(KEY_SAVED_AT, System.currentTimeMillis())
            .apply {
                if (etag.isNullOrBlank()) remove(KEY_ETAG) else putString(KEY_ETAG, etag)
            }
            .apply()
    }

    private fun touchCache() {
        preferences.edit()
            .putLong(KEY_SAVED_AT, System.currentTimeMillis())
            .apply()
    }

    private fun clearInvalidCache() {
        preferences.edit()
            .remove(KEY_CONFIG_JSON)
            .remove(KEY_SAVED_AT)
            .remove(KEY_ETAG)
            .apply()
    }

    private fun decodeAndValidate(raw: String): AppRemoteConfig {
        val decoded = json.decodeFromString<AppRemoteConfig>(raw)
        return validate(decoded)
    }

    private fun validate(config: AppRemoteConfig): AppRemoteConfig {
        require(config.schemaVersion in 1..SUPPORTED_SCHEMA_VERSION) {
            "Schema remoto não suportado: ${config.schemaVersion}"
        }
        require(config.revision >= 1) { "Revisão remota inválida." }
        require(config.minAppVersionCode >= 1) { "Versão mínima do app inválida." }
        require(config.pollSeconds in MIN_POLL_SECONDS..MAX_POLL_SECONDS) {
            "Intervalo de atualização remoto inválido."
        }

        val normalizedTheme = config.theme.trim().lowercase()
        require(normalizedTheme in setOf("system", "light", "dark")) {
            "Tema remoto inválido."
        }

        require(config.navigation.hasAnyVisible()) {
            "A navegação remota precisa manter pelo menos uma seção visível."
        }

        validateRemoteMessage(
            eyebrow = config.maintenance.eyebrow,
            title = config.maintenance.title,
            message = config.maintenance.message,
            prefix = "Manutenção"
        )
        validateRemoteMessage(
            eyebrow = config.update.eyebrow,
            title = config.update.title,
            message = config.update.message,
            prefix = "Atualização"
        )
        require(config.update.url.length <= 500) { "URL de atualização excede 500 caracteres." }
        require(
            config.update.url.isBlank() ||
                config.update.url.startsWith("https://") ||
                config.update.url.startsWith("http://")
        ) { "URL de atualização inválida." }

        val normalizedTone = config.dashboardBanner.tone.trim().lowercase()
        require(normalizedTone in setOf("accent", "success", "warning", "neutral")) {
            "Tom do banner remoto inválido."
        }
        require(config.dashboardBanner.eyebrow.length <= 30) {
            "Eyebrow do banner remoto excede 30 caracteres."
        }
        require(config.dashboardBanner.title.length <= 80) {
            "Título do banner remoto excede 80 caracteres."
        }
        require(config.dashboardBanner.message.length <= 280) {
            "Mensagem do banner remoto excede 280 caracteres."
        }

        val sectionOrder = config.dashboardSectionOrder.map { it.trim().lowercase() }
        require(sectionOrder.size == allowedDashboardSections.size && sectionOrder.toSet() == allowedDashboardSections) {
            "Ordem remota das seções do dashboard inválida."
        }

        return config.copy(
            theme = normalizedTheme,
            dashboardBanner = config.dashboardBanner.copy(tone = normalizedTone),
            dashboardSectionOrder = sectionOrder
        )
    }

    private fun validateRemoteMessage(
        eyebrow: String,
        title: String,
        message: String,
        prefix: String
    ) {
        require(eyebrow.length <= 32) { "$prefix: eyebrow excede 32 caracteres." }
        require(title.length <= 90) { "$prefix: título excede 90 caracteres." }
        require(message.length <= 320) { "$prefix: mensagem excede 320 caracteres." }
    }
}
