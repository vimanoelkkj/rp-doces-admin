package br.com.rpdoces.admin.ui.theme

import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

/**
 * Espelho dos tokens de admin-v2/src/tokens.css e AdminShell.module.css.
 *
 * O app nativo não consegue aplicar CSS diretamente ao Jetpack Compose, então
 * estes valores são a fonte de verdade do lado Android. Sempre que o CSS base
 * mudar, este arquivo deve acompanhar a mesma alteração.
 */
@Immutable
data class RPWebColors(
    val appBackground: Color,
    val surface: Color,
    val surfaceSoft: Color,
    val border: Color,
    val borderStrong: Color,
    val text: Color,
    val muted: Color,
    val inkSoft: Color,
    val accent: Color,
    val accentDark: Color,
    val accentSoft: Color,
    val accentWash: Color,
    val success: Color,
    val warning: Color,
    val danger: Color,
    val radialOne: Color,
    val radialTwo: Color
)

val RPWebLightColors = RPWebColors(
    appBackground = Color(0xFFFBF8F4),
    surface = Color(0xFFFFFDFA),
    surfaceSoft = Color(0xFFFFFAF7),
    border = Color(0xFFEEE7E2),
    borderStrong = Color(0xFFE7DED8),
    text = Color(0xFF24252A),
    muted = Color(0xFF7D8088),
    inkSoft = Color(0xFF6E4F45),
    accent = Color(0xFFD84C6C),
    accentDark = Color(0xFFCF3F61),
    accentSoft = Color(0xFFFBE9EE),
    accentWash = Color(0xFFFFF6F7),
    success = Color(0xFF2F9B63),
    warning = Color(0xFFED8A22),
    danger = Color(0xFFC7434D),
    radialOne = Color(0x3DF4DFD7),
    radialTwo = Color(0x29F2DCD8)
)

val RPWebDarkColors = RPWebColors(
    appBackground = Color(0xFF1B1614),
    surface = Color(0xFF241D1A),
    surfaceSoft = Color(0xFF221B18),
    border = Color(0xFF362C27),
    borderStrong = Color(0xFF3D322C),
    text = Color(0xFFF1E9E3),
    muted = Color(0xFFA89C92),
    inkSoft = Color(0xFFC1B4AA),
    accent = Color(0xFFEF6F8B),
    accentDark = Color(0xFFF0839C),
    accentSoft = Color(0xFF3A232B),
    accentWash = Color(0xFF2C2020),
    success = Color(0xFF4BBF85),
    warning = Color(0xFFF0A04F),
    danger = Color(0xFFEF7489),
    radialOne = Color(0x24783C32),
    radialTwo = Color(0x1A643732)
)

val LocalRPWebColors = staticCompositionLocalOf { RPWebLightColors }

object RPWebMetrics {
    val radius = 14.dp
    val mobileWorkspacePadding = 12.dp
    val mobileContentTop = 68.dp
    val mobileContentBottom = 72.dp
    val mobileHeaderHorizontalMargin = 2.dp
    val mobileHeaderBottomMargin = 18.dp
    val utilityTopMin = 12.dp
    val utilityRight = 12.dp
    val utilityGap = 6.dp
    val utilitySize = 40.dp
    val utilityRadius = 12.dp
    val avatarSize = 32.dp
    val bottomBarOuterPadding = 4.dp
    val bottomNavItemHeight = 52.dp
    val bottomNavIndicatorWidth = 22.dp
    val bottomNavIndicatorHeight = 2.dp
    val bottomNavIconBox = 21.dp
    val bottomNavIcon = 18.dp
}
