package br.com.rpdoces.admin.data.remote

import br.com.rpdoces.admin.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.Request

@Serializable
data class AppRemoteConfig(
    val revision: Int = 1,
    @SerialName("dashboard_banner") val dashboardBanner: DashboardRemoteBanner = DashboardRemoteBanner()
)

@Serializable
data class DashboardRemoteBanner(
    val enabled: Boolean = false,
    val title: String = "",
    val message: String = ""
)

class AppRemoteConfigRepository {
    private val client = OkHttpClient()
    private val json = Json { ignoreUnknownKeys = true }

    suspend fun fetch(): AppRemoteConfig = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url("${BuildConfig.API_ORIGIN}/app-config.json?t=${System.currentTimeMillis()}")
            .header("Cache-Control", "no-cache")
            .build()

        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                throw IllegalStateException("Remote config HTTP ${response.code}")
            }
            val body = response.body.string()
            json.decodeFromString<AppRemoteConfig>(body)
        }
    }
}
