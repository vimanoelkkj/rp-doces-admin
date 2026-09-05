package br.com.rpdoces.admin.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.material3.ProvideTextStyle
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.googlefonts.Font
import androidx.compose.ui.text.googlefonts.GoogleFont
import br.com.rpdoces.admin.R

private val LightColors = lightColorScheme(
    primary = Color(0xFFD84C6C),
    onPrimary = Color.White,
    primaryContainer = Color(0xFFFBE9EE),
    onPrimaryContainer = Color(0xFF6E2437),
    secondary = Color(0xFF6E4F45),
    onSecondary = Color.White,
    background = Color(0xFFFBF8F4),
    onBackground = Color(0xFF24252A),
    surface = Color(0xFFFFFDFA),
    onSurface = Color(0xFF24252A),
    surfaceVariant = Color(0xFFFFFAF7),
    onSurfaceVariant = Color(0xFF7D8088),
    outline = Color(0xFFEEE7E2),
    error = Color(0xFFC7434D)
)

private val DarkColors = darkColorScheme(
    primary = Color(0xFFEF6F8B),
    onPrimary = Color(0xFF2F1018),
    primaryContainer = Color(0xFF3A232B),
    onPrimaryContainer = Color(0xFFFFD9E1),
    secondary = Color(0xFFC1B4AA),
    onSecondary = Color(0xFF281B17),
    background = Color(0xFF1B1614),
    onBackground = Color(0xFFF1E9E3),
    surface = Color(0xFF241D1A),
    onSurface = Color(0xFFF1E9E3),
    surfaceVariant = Color(0xFF221B18),
    onSurfaceVariant = Color(0xFFA89C92),
    outline = Color(0xFF362C27),
    error = Color(0xFFEF7489)
)

private val GoogleFontsProvider = GoogleFont.Provider(
    providerAuthority = "com.google.android.gms.fonts",
    providerPackage = "com.google.android.gms",
    certificates = R.array.com_google_android_gms_fonts_certs
)

private val Manrope = GoogleFont("Manrope")

private val ManropeFamily = FontFamily(
    Font(googleFont = Manrope, fontProvider = GoogleFontsProvider, weight = FontWeight.Normal, style = FontStyle.Normal),
    Font(googleFont = Manrope, fontProvider = GoogleFontsProvider, weight = FontWeight.Medium, style = FontStyle.Normal),
    Font(googleFont = Manrope, fontProvider = GoogleFontsProvider, weight = FontWeight.SemiBold, style = FontStyle.Normal),
    Font(googleFont = Manrope, fontProvider = GoogleFontsProvider, weight = FontWeight.Bold, style = FontStyle.Normal),
    Font(googleFont = Manrope, fontProvider = GoogleFontsProvider, weight = FontWeight.ExtraBold, style = FontStyle.Normal)
)

private val Defaults = Typography()
private val RPTypography = Typography(
    displayLarge = Defaults.displayLarge.copy(fontFamily = ManropeFamily),
    displayMedium = Defaults.displayMedium.copy(fontFamily = ManropeFamily),
    displaySmall = Defaults.displaySmall.copy(fontFamily = ManropeFamily),
    headlineLarge = Defaults.headlineLarge.copy(fontFamily = ManropeFamily),
    headlineMedium = Defaults.headlineMedium.copy(fontFamily = ManropeFamily),
    headlineSmall = Defaults.headlineSmall.copy(fontFamily = ManropeFamily),
    titleLarge = Defaults.titleLarge.copy(fontFamily = ManropeFamily),
    titleMedium = Defaults.titleMedium.copy(fontFamily = ManropeFamily),
    titleSmall = Defaults.titleSmall.copy(fontFamily = ManropeFamily),
    bodyLarge = Defaults.bodyLarge.copy(fontFamily = ManropeFamily),
    bodyMedium = Defaults.bodyMedium.copy(fontFamily = ManropeFamily),
    bodySmall = Defaults.bodySmall.copy(fontFamily = ManropeFamily),
    labelLarge = Defaults.labelLarge.copy(fontFamily = ManropeFamily),
    labelMedium = Defaults.labelMedium.copy(fontFamily = ManropeFamily),
    labelSmall = Defaults.labelSmall.copy(fontFamily = ManropeFamily)
)

@Composable
fun RPTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit
) {
    MaterialTheme(
        colorScheme = if (darkTheme) DarkColors else LightColors,
        typography = RPTypography
    ) {
        ProvideTextStyle(MaterialTheme.typography.bodyMedium) {
            content()
        }
    }
}
