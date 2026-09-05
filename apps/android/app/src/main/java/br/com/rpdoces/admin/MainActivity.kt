package br.com.rpdoces.admin

import android.os.Bundle
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.fragment.app.FragmentActivity
import br.com.rpdoces.admin.data.remote.AppRemoteConfigRepository
import br.com.rpdoces.admin.ui.BiometricRPApp
import br.com.rpdoces.admin.ui.remote.LocalAppRemoteConfig
import br.com.rpdoces.admin.ui.remote.RemoteMaintenanceScreen
import br.com.rpdoces.admin.ui.remote.RemoteUpdateRequiredScreen
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
            val remoteConfigRepository = remember {
                AppRemoteConfigRepository(applicationContext)
            }
            var remoteConfig by remember(remoteConfigRepository) {
                mutableStateOf(remoteConfigRepository.cachedOrDefault())
            }

            LaunchedEffect(remoteConfigRepository) {
                while (isActive) {
                    runCatching { remoteConfigRepository.fetch() }
                        .onSuccess { remoteConfig = it }

                    delay(remoteConfig.pollSeconds.coerceIn(3L, 300L) * 1_000L)
                }
            }

            val forcedDarkTheme = when (remoteConfig.theme) {
                "dark" -> true
                "light" -> false
                else -> null
            }

            CompositionLocalProvider(LocalAppRemoteConfig provides remoteConfig) {
                RPTheme(darkTheme = forcedDarkTheme) {
                    when {
                        remoteConfig.maintenance.enabled -> RemoteMaintenanceScreen(remoteConfig.maintenance)
                        remoteConfig.minAppVersionCode > BuildConfig.VERSION_CODE -> RemoteUpdateRequiredScreen(
                            config = remoteConfig.update,
                            currentVersion = BuildConfig.VERSION_NAME
                        )
                        else -> BiometricRPApp(
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
    }
}
