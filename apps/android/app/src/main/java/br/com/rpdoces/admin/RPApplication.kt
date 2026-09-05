package br.com.rpdoces.admin

import android.app.Application
import br.com.rpdoces.admin.data.auth.AuthRepository
import br.com.rpdoces.admin.data.dashboard.DashboardRepository
import br.com.rpdoces.admin.data.network.ApiClient
import br.com.rpdoces.admin.data.network.SessionCookieJar

class RPApplication : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
    }
}

class AppContainer(application: Application) {
    private val sessionCookieJar = SessionCookieJar(application)
    private val apiClient = ApiClient(sessionCookieJar)

    val authRepository = AuthRepository(
        retrofit = apiClient.retrofit,
        json = apiClient.json,
        cookieJar = sessionCookieJar
    )

    val dashboardRepository = DashboardRepository(apiClient.retrofit)
}
