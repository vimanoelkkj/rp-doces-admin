package br.com.rpdoces.admin.ui

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser

/**
 * Ícones da navegação copiados 1:1 dos SVGs usados em admin-v2/src/layout/AdminShell.tsx.
 * ViewBox 24x24, fill none, stroke currentColor, stroke-width 1.7,
 * stroke-linecap round e stroke-linejoin round, exatamente como no CSS web.
 */
internal object SiteNavIcons {
    private val stroke = SolidColor(Color.Black)

    val Dashboard: ImageVector by lazy {
        vector(
            "dashboard",
            "M4 3H9a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z " +
                "M15 3H20a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z " +
                "M4 14H9a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1Z " +
                "M15 14H20a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1Z"
        )
    }

    val Products: ImageVector by lazy {
        vector(
            "products",
            "M12 3 20 7.5v9L12 21l-8-4.5v-9L12 3Z " +
                "M4.5 7.8 12 12.1l7.5-4.3 M12 12v9"
        )
    }

    val Orders: ImageVector by lazy {
        vector(
            "orders",
            "M7 6h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z " +
                "M9 6V4h6v2 M9 11h6 M9 15h4"
        )
    }

    val Users: ImageVector by lazy {
        vector(
            "users",
            "M12 8a3 3 0 1 1-6 0 3 3 0 1 1 6 0 " +
                "M4 20c0-3 2.2-5 5-5s5 2 5 5 M17 7v6 M14 10h6"
        )
    }

    val Store: ImageVector by lazy {
        vector(
            "store",
            "M4 9h16l-2-5H6L4 9Z M5 9v11h14V9 M9 20v-6h6v6"
        )
    }

    private fun vector(name: String, svgPath: String): ImageVector =
        ImageVector.Builder(
            name = name,
            defaultWidth = 24f.toDp(),
            defaultHeight = 24f.toDp(),
            viewportWidth = 24f,
            viewportHeight = 24f
        ).apply {
            addPath(
                pathData = PathParser().parsePathString(svgPath).toNodes(),
                fill = null,
                stroke = stroke,
                strokeLineWidth = 1.7f,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round
            )
        }.build()

    private fun Float.toDp() = androidx.compose.ui.unit.Dp(this)
}
