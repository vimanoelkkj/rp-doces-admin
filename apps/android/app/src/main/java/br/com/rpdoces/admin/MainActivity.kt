package br.com.rpdoces.admin

import android.os.Bundle
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.fragment.app.FragmentActivity
import br.com.rpdoces.admin.data.remote.AppRemoteConfigRepository
import br.com.rpdoces.admin.ui.BiometricRPApp
import br.com.rpdoces.admin.ui.theme.RPTheme
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive

class MainActivity : FragmentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(0xFFEF6F8B.toInt())
        )

        val container = (application as RPApplication).container
        setContent {
            val remoteConfigRepository = remember { AppRemoteConfigRepository() }
            var remoteTheme by remember { mutableStateOf("system") }

            LaunchedEffect(remoteConfigRepository) {
                while (isActive) {
                    runCatching { remoteConfigRepository.fetch() }
                        .onSuccess { remoteTheme = it.theme.lowercase() }
                    delay(5_000L)
                }
            }

            val forcedDarkTheme = when (remoteTheme) {
                "dark" -> true
                "light" -> false
                else -> null
            }

            RPTheme(darkTheme = forcedDarkTheme) {
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
