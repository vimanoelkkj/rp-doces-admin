package br.com.rpdoces.admin

import android.app.Application
import br.com.rpdoces.admin.data.admins.AdminsRepository
import br.com.rpdoces.admin.data.auth.AuthRepository
import br.com.rpdoces.admin.data.dashboard.DashboardRepository
import br.com.rpdoces.admin.data.network.ApiClient
import br.com.rpdoces.admin.data.network.SessionCookieJar
import br.com.rpdoces.admin.data.orders.OrdersRepository
import br.com.rpdoces.admin.data.products.ProductsRepository
import br.com.rpdoces.admin.data.store.StoreRepository

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
    val productsRepository = ProductsRepository(apiClient.retrofit)
    val ordersRepository = OrdersRepository(apiClient.retrofit)
    val adminsRepository = AdminsRepository(apiClient.retrofit)
    val storeRepository = StoreRepository(apiClient.retrofit)
}
