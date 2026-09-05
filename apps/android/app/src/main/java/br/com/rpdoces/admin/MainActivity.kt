package br.com.rpdoces.admin

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import br.com.rpdoces.admin.ui.RPApp
import br.com.rpdoces.admin.ui.theme.RPTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(0xFFEF6F8B.toInt())
        )

        val container = (application as RPApplication).container
        setContent {
            RPTheme {
                RPApp(
                    authRepository = container.authRepository,
                    dashboardRepository = container.dashboardRepository
                )
            }
        }
    }
}
