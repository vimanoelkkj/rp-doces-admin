package br.com.rpdoces.admin.ui.theme

import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

/**
 * Espelho dos tokens de admin-v2/src/tokens.css e AdminShell.module.css.
 *
 * CSS não estiliza Jetpack Compose diretamente. Por isso o Android usa estes
 * mesmos valores como fonte de verdade, em vez de manter uma paleta paralela.
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
    val pinkRow: Color,
    val orange: Color,
    val orangeSoft: Color,
    val green: Color,
    val greenSoft: Color,
    val purple: Color,
    val purpleSoft: Color,
    val graySoft: Color,
    val hoverNav: Color,
    val surfaceVeilOne: Color,
    val surfaceVeilTwo: Color,
    val surfaceVeilThree: Color,
    val pinkBorder: Color,
    val tagOrangeText: Color,
    val tagGreenText: Color,
    val success: Color,
    val warning: Color,
    val danger: Color,
    val shadow: Color,
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
    pinkRow = Color(0xFFFFF5F7),
    orange = Color(0xFFED8A22),
    orangeSoft = Color(0xFFFFF1DF),
    green = Color(0xFF2F9B63),
    greenSoft = Color(0xFFE7F6ED),
    purple = Color(0xFF705BC4),
    purpleSoft = Color(0xFFF0ECFF),
    graySoft = Color(0xFFF2F2F0),
    hoverNav = Color(0xFFFFF6F7),
    surfaceVeilOne = Color(0x8AFFF CF8).let { Color(0x8AFFF CF8) },
    surfaceVeilTwo = Color(0xBDFFF DFA).let { Color(0xBDFFF DFA) },
    surfaceVeilThree = Color(0xEBFFF DFA).let { Color(0xEBFFF DFA) },
    pinkBorder = Color(0xFFF0A8B9),
    tagOrangeText = Color(0xFFDB7618),
    tagGreenText = Color(0xFF278050),
    success = Color(0xFF2F9B63),
    warning = Color(0xFFED8A22),
    danger = Color(0xFFC7434D),
    shadow = Color(0x0D3F2B22),
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
    pinkRow = Color(0xFF2C1E22),
    orange = Color(0xFFF0A04F),
    orangeSoft = Color(0xFF3A2A17),
    green = Color(0xFF4BBF85),
    greenSoft = Color(0xFF17301F),
    purple = Color(0xFF9483D9),
    purpleSoft = Color(0xFF2A2440),
    graySoft = Color(0xFF2A2422),
    hoverNav = Color(0xFF2C2020),
    surfaceVeilOne = Color(0x99241D1A),
    surfaceVeilTwo = Color(0xC2241D1A),
    surfaceVeilThree = Color(0xF0241D1A),
    pinkBorder = Color(0xFF6B3644),
    tagOrangeText = Color(0xFFF0A04F),
    tagGreenText = Color(0xFF58CF93),
    success = Color(0xFF4BBF85),
    warning = Color(0xFFF0A04F),
    danger = Color(0xFFEF7489),
    shadow = Color(0x73000000),
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
