package br.com.rpdoces.admin

import android.os.Bundle
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.fragment.app.FragmentActivity
import br.com.rpdoces.admin.ui.BiometricRPApp
import br.com.rpdoces.admin.ui.theme.RPTheme

class MainActivity : FragmentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(0xFFEF6F8B.toInt())
        )

        val container = (application as RPApplication).container
        setContent {
            RPTheme {
                BiometricRPApp(
                    authRepository = container.authRepository,
                    dashboardRepository = container.dashboardRepository,
                    productsRepository = container.productsRepository,
                    ordersRepository = container.ordersRepository,
                    adminsRepository = container.adminsRepository,
                    storeRepository = container.storeRepository
                )
            }
        }
    }
}
