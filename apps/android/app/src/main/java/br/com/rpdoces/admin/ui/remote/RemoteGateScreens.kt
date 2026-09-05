package br.com.rpdoces.admin.ui.remote

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import br.com.rpdoces.admin.data.remote.RemoteMaintenance
import br.com.rpdoces.admin.data.remote.RemoteUpdate
import br.com.rpdoces.admin.ui.theme.LocalRPWebColors

@Composable
fun RemoteMaintenanceScreen(config: RemoteMaintenance) {
    RemoteGateShell(
        eyebrow = config.eyebrow,
        title = config.title,
        message = config.message,
        footer = "O aplicativo verifica automaticamente quando o acesso for liberado."
    )
}

@Composable
fun RemoteUpdateRequiredScreen(
    config: RemoteUpdate,
    currentVersion: String
) {
    val context = LocalContext.current
    RemoteGateShell(
        eyebrow = config.eyebrow,
        title = config.title,
        message = config.message,
        footer = "Versão instalada: $currentVersion",
        actionLabel = config.url.takeIf { it.isNotBlank() }?.let { "Atualizar aplicativo" },
        onAction = config.url.takeIf { it.isNotBlank() }?.let { url ->
            {
                runCatching {
                    context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                }
            }
        }
    )
}

@Composable
private fun RemoteGateShell(
    eyebrow: String,
    title: String,
    message: String,
    footer: String,
    actionLabel: String? = null,
    onAction: (() -> Unit)? = null
) {
    val web = LocalRPWebColors.current

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(
                Brush.verticalGradient(
                    listOf(web.appBackground, web.surfaceSoft, web.appBackground)
                )
            )
            .padding(horizontal = 22.dp),
        contentAlignment = Alignment.Center
    ) {
        Surface(
            modifier = Modifier.fillMaxWidth().widthIn(max = 430.dp),
            shape = RoundedCornerShape(18.dp),
            color = web.surfaceVeilThree,
            border = BorderStroke(1.dp, web.border),
            shadowElevation = 18.dp
        ) {
            Column(
                modifier = Modifier.padding(horizontal = 22.dp, vertical = 24.dp),
                verticalArrangement = Arrangement.spacedBy(0.dp)
            ) {
                RowBrand()
                Spacer(Modifier.height(22.dp))
                Text(
                    text = eyebrow.uppercase(),
                    color = web.accentDark,
                    fontSize = 9.5.sp,
                    fontWeight = FontWeight.ExtraBold,
                    letterSpacing = .7.sp
                )
                Text(
                    text = title,
                    color = web.text,
                    fontSize = 23.sp,
                    lineHeight = 28.sp,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.padding(top = 6.dp)
                )
                Text(
                    text = message,
                    color = web.muted,
                    fontSize = 12.sp,
                    lineHeight = 18.sp,
                    modifier = Modifier.padding(top = 9.dp)
                )

                if (actionLabel != null && onAction != null) {
                    Surface(
                        onClick = onAction,
                        modifier = Modifier.fillMaxWidth().padding(top = 20.dp),
                        shape = RoundedCornerShape(10.dp),
                        color = web.accent,
                        border = BorderStroke(1.dp, web.accentDark)
                    ) {
                        Box(modifier = Modifier.height(44.dp), contentAlignment = Alignment.Center) {
                            Text(
                                actionLabel,
                                color = Color.White,
                                fontSize = 11.5.sp,
                                fontWeight = FontWeight.Bold
                            )
                        }
                    }
                }

                Text(
                    text = footer,
                    color = web.muted,
                    fontSize = 9.5.sp,
                    lineHeight = 14.sp,
                    modifier = Modifier.padding(top = 18.dp)
                )
            }
        }
    }
}

@Composable
private fun RowBrand() {
    val web = LocalRPWebColors.current
    androidx.compose.foundation.layout.Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(9.dp)
    ) {
        Text(
            text = "R&P",
            color = web.text,
            fontSize = 18.sp,
            fontWeight = FontWeight.ExtraBold,
            letterSpacing = (-.5).sp
        )
        Surface(
            shape = RoundedCornerShape(99.dp),
            color = web.accentSoft,
            border = BorderStroke(1.dp, web.accent.copy(alpha = .35f))
        ) {
            Text(
                text = "V2",
                color = web.accentDark,
                fontSize = 8.5.sp,
                fontWeight = FontWeight.ExtraBold,
                modifier = Modifier.padding(horizontal = 7.dp, vertical = 3.dp)
            )
        }
    }
}
