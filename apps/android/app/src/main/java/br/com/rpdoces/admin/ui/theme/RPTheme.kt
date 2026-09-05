package br.com.rpdoces.admin.ui.theme

import android.content.Context
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.LocalRippleConfiguration
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ProvideTextStyle
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.googlefonts.Font
import androidx.compose.ui.text.googlefonts.GoogleFont
import br.com.rpdoces.admin.R

private const val THEME_PREFS = "rp_admin_preferences"
private const val THEME_KEY = "theme"

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

data class RPThemeController(
    val isDark: Boolean,
    val toggle: () -> Unit
)

val LocalRPThemeController = staticCompositionLocalOf {
    RPThemeController(isDark = false, toggle = {})
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

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RPTheme(
    darkTheme: Boolean? = null,
    content: @Composable () -> Unit
) {
    val context = LocalContext.current
    val systemDark = isSystemInDarkTheme()
    val preferences = remember(context) {
        context.getSharedPreferences(THEME_PREFS, Context.MODE_PRIVATE)
    }
    var storedTheme by remember {
        mutableStateOf(preferences.getString(THEME_KEY, null))
    }

    val effectiveDark = darkTheme ?: when (storedTheme) {
        "dark" -> true
        "light" -> false
        else -> systemDark
    }
    val webColors = if (effectiveDark) RPWebDarkColors else RPWebLightColors
    val controller = RPThemeController(
        isDark = effectiveDark,
        toggle = {
            val next = if (effectiveDark) "light" else "dark"
            preferences.edit().putString(THEME_KEY, next).apply()
            storedTheme = next
        }
    )

    CompositionLocalProvider(
        LocalRPWebColors provides webColors,
        LocalRPThemeController provides controller,
        LocalRippleConfiguration provides null
    ) {
        MaterialTheme(
            colorScheme = if (effectiveDark) darkScheme(webColors) else lightScheme(webColors),
            typography = RPTypography
        ) {
            ProvideTextStyle(MaterialTheme.typography.bodyMedium) {
                content()
            }
        }
    }
}
