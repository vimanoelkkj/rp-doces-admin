package br.com.rpdoces.admin.ui.dashboard

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import br.com.rpdoces.admin.data.remote.DashboardRemoteBanner
import br.com.rpdoces.admin.ui.components.RPMotion
import br.com.rpdoces.admin.ui.theme.LocalRPWebColors

private val RemoteWarning = Color(0xFFF0A04F)

@Composable
internal fun RemoteDashboardBanner(
    banner: DashboardRemoteBanner,
    modifier: Modifier = Modifier
) {
    val web = LocalRPWebColors.current

    AnimatedContent(
        targetState = banner,
        modifier = modifier.fillMaxWidth(),
        transitionSpec = {
            (fadeIn(tween(RPMotion.Fast, easing = RPMotion.EaseOut)) +
                slideInVertically(tween(RPMotion.Normal, easing = RPMotion.EaseOut)) { it / 5 }) togetherWith
                (fadeOut(tween(RPMotion.Quick)) +
                    slideOutVertically(tween(RPMotion.Fast)) { -it / 6 })
        },
        label = "remote-dashboard-banner"
    ) { current ->
        val accent = when (current.tone) {
            "success" -> web.tagGreenText
            "warning" -> RemoteWarning
            "neutral" -> web.muted
            else -> web.accentDark
        }
        val background = when (current.tone) {
            "success" -> web.greenSoft
            "warning" -> RemoteWarning.copy(alpha = .12f)
            "neutral" -> web.graySoft
            else -> web.accentSoft
        }
        val border = when (current.tone) {
            "warning" -> RemoteWarning.copy(alpha = .48f)
            "neutral" -> web.borderStrong
            else -> accent.copy(alpha = .32f)
        }

        Surface(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(14.dp),
            color = background,
            border = BorderStroke(1.dp, border)
        ) {
            Row(
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 14.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.Top
            ) {
                Box(
                    modifier = Modifier
                        .padding(top = 5.dp)
                        .size(8.dp)
                        .background(accent, RoundedCornerShape(99.dp))
                )

                Column(modifier = Modifier.weight(1f)) {
                    if (current.eyebrow.isNotBlank()) {
                        Text(
                            text = current.eyebrow.uppercase(),
                            color = accent,
                            fontSize = 9.sp,
                            lineHeight = 11.sp,
                            fontWeight = FontWeight.ExtraBold,
                            letterSpacing = .55.sp
                        )
                        Spacer(Modifier.height(4.dp))
                    }
                    if (current.title.isNotBlank()) {
                        Text(
                            text = current.title,
                            color = web.text,
                            fontSize = 13.sp,
                            lineHeight = 17.sp,
                            fontWeight = FontWeight.Bold
                        )
                    }
                    if (current.message.isNotBlank()) {
                        Text(
                            text = current.message,
                            modifier = Modifier.padding(top = if (current.title.isNotBlank()) 4.dp else 0.dp),
                            color = web.muted,
                            fontSize = 10.5.sp,
                            lineHeight = 15.sp
                        )
                    }
                }
            }
        }
    }
}
