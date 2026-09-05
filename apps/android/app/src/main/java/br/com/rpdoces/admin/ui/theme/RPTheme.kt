package br.com.rpdoces.admin.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ProvideTextStyle
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.googlefonts.Font
import androidx.compose.ui.text.googlefonts.GoogleFont
import br.com.rpdoces.admin.R

private val GoogleFontsProvider = GoogleFont.Provider(
    providerAuthority = "com.google.android.gms.fonts",
    providerPackage = "com.google.android.gms",
    certificates = R.array.com_google_android_gms_fonts_certs
)

private fun googleFamily(name: String): FontFamily {
    val font = GoogleFont(name)
    return FontFamily(
        Font(googleFont = font, fontProvider = GoogleFontsProvider, weight = FontWeight.Normal, style = FontStyle.Normal),
        Font(googleFont = font, fontProvider = GoogleFontsProvider, weight = FontWeight.Medium, style = FontStyle.Normal),
        Font(googleFont = font, fontProvider = GoogleFontsProvider, weight = FontWeight.SemiBold, style = FontStyle.Normal),
        Font(googleFont = font, fontProvider = GoogleFontsProvider, weight = FontWeight.Bold, style = FontStyle.Normal),
        Font(googleFont = font, fontProvider = GoogleFontsProvider, weight = FontWeight.ExtraBold, style = FontStyle.Normal)
    )
}

/** Mesmas famílias declaradas no Admin V2 web. */
object RPWebFonts {
    val Manrope = googleFamily("Manrope")
    val NunitoSans = googleFamily("Nunito Sans")
    val BricolageGrotesque = googleFamily("Bricolage Grotesque")
}

private fun lightScheme(colors: RPWebColors) = lightColorScheme(
    primary = colors.accent,
    onPrimary = androidx.compose.ui.graphics.Color.White,
    primaryContainer = colors.accentSoft,
    onPrimaryContainer = colors.inkSoft,
    secondary = colors.inkSoft,
    onSecondary = androidx.compose.ui.graphics.Color.White,
    background = colors.appBackground,
    onBackground = colors.text,
    surface = colors.surface,
    onSurface = colors.text,
    surfaceVariant = colors.surfaceSoft,
    onSurfaceVariant = colors.muted,
    outline = colors.border,
    error = colors.danger
)

private fun darkScheme(colors: RPWebColors) = darkColorScheme(
    primary = colors.accent,
    onPrimary = colors.appBackground,
    primaryContainer = colors.accentSoft,
    onPrimaryContainer = colors.text,
    secondary = colors.inkSoft,
    onSecondary = colors.appBackground,
    background = colors.appBackground,
    onBackground = colors.text,
    surface = colors.surface,
    onSurface = colors.text,
    surfaceVariant = colors.surfaceSoft,
    onSurfaceVariant = colors.muted,
    outline = colors.border,
    error = colors.danger
)

private val Defaults = Typography()
private val RPTypography = Typography(
    displayLarge = Defaults.displayLarge.copy(fontFamily = RPWebFonts.Manrope),
    displayMedium = Defaults.displayMedium.copy(fontFamily = RPWebFonts.Manrope),
    displaySmall = Defaults.displaySmall.copy(fontFamily = RPWebFonts.Manrope),
    headlineLarge = Defaults.headlineLarge.copy(fontFamily = RPWebFonts.Manrope),
    headlineMedium = Defaults.headlineMedium.copy(fontFamily = RPWebFonts.Manrope),
    headlineSmall = Defaults.headlineSmall.copy(fontFamily = RPWebFonts.Manrope),
    titleLarge = Defaults.titleLarge.copy(fontFamily = RPWebFonts.Manrope),
    titleMedium = Defaults.titleMedium.copy(fontFamily = RPWebFonts.Manrope),
    titleSmall = Defaults.titleSmall.copy(fontFamily = RPWebFonts.Manrope),
    bodyLarge = Defaults.bodyLarge.copy(fontFamily = RPWebFonts.Manrope),
    bodyMedium = Defaults.bodyMedium.copy(fontFamily = RPWebFonts.Manrope),
    bodySmall = Defaults.bodySmall.copy(fontFamily = RPWebFonts.Manrope),
    labelLarge = Defaults.labelLarge.copy(fontFamily = RPWebFonts.Manrope),
    labelMedium = Defaults.labelMedium.copy(fontFamily = RPWebFonts.Manrope),
    labelSmall = Defaults.labelSmall.copy(fontFamily = RPWebFonts.Manrope)
)

@Composable
fun RPTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit
) {
    val webColors = if (darkTheme) RPWebDarkColors else RPWebLightColors
    CompositionLocalProvider(LocalRPWebColors provides webColors) {
        MaterialTheme(
            colorScheme = if (darkTheme) darkScheme(webColors) else lightScheme(webColors),
            typography = RPTypography
        ) {
            ProvideTextStyle(MaterialTheme.typography.bodyMedium) {
                content()
            }
        }
    }
}
