package br.com.rpdoces.admin.ui.components

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.KeyboardArrowDown
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import br.com.rpdoces.admin.ui.theme.LocalRPWebColors

object RPMotion {
    const val Quick = 120
    const val Fast = 170
    const val Normal = 230
    const val Slow = 320

    val EaseOut = CubicBezierEasing(0.16f, 1f, 0.3f, 1f)
    val EaseInOut = CubicBezierEasing(0.65f, 0f, 0.35f, 1f)
}

@Composable
fun MotionDropdownMenu(
    expanded: Boolean,
    onDismissRequest: () -> Unit,
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit
) {
    val web = LocalRPWebColors.current
    val menuShape = RoundedCornerShape(14.dp)
    val scale by animateFloatAsState(
        targetValue = if (expanded) 1f else .975f,
        animationSpec = tween(RPMotion.Fast, easing = RPMotion.EaseOut),
        label = "menu-scale"
    )
    val alpha by animateFloatAsState(
        targetValue = if (expanded) 1f else 0f,
        animationSpec = tween(if (expanded) RPMotion.Fast else RPMotion.Quick),
        label = "menu-alpha"
    )

    DropdownMenu(
        expanded = expanded,
        onDismissRequest = onDismissRequest,
        modifier = modifier
            .clip(menuShape)
            .background(web.surface, menuShape)
            .border(1.dp, web.borderStrong, menuShape)
            .graphicsLayer {
                scaleX = scale
                scaleY = scale
                this.alpha = alpha
                transformOrigin = TransformOrigin(.88f, 0f)
            },
        content = content
    )
}

@Composable
fun WebSelectorOption(
    text: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true
) {
    val web = LocalRPWebColors.current
    Surface(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 6.dp, vertical = 1.dp)
            .heightIn(min = 50.dp),
        shape = RoundedCornerShape(10.dp),
        color = if (selected) web.accentSoft else Color.Transparent
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            Text(
                text = text,
                modifier = Modifier.weight(1f),
                color = if (selected) web.accentDark else web.text,
                fontSize = 13.sp,
                fontWeight = FontWeight.Bold,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis
            )
            Surface(
                modifier = Modifier.size(17.dp),
                shape = CircleShape,
                color = web.surface,
                border = BorderStroke(2.dp, if (selected) web.accent else web.muted)
            ) {
                Box(contentAlignment = Alignment.Center) {
                    if (selected) {
                        Box(
                            modifier = Modifier
                                .size(7.dp)
                                .background(web.accent, CircleShape)
                        )
                    }
                }
            }
        }
    }
}

@Composable
fun MotionChevron(
    expanded: Boolean,
    tint: Color,
    modifier: Modifier = Modifier
) {
    val rotation by animateFloatAsState(
        targetValue = if (expanded) 180f else 0f,
        animationSpec = tween(RPMotion.Normal, easing = RPMotion.EaseOut),
        label = "selector-chevron"
    )
    Icon(
        imageVector = Icons.Outlined.KeyboardArrowDown,
        contentDescription = null,
        tint = tint,
        modifier = modifier.graphicsLayer { rotationZ = rotation }
    )
}

@Composable
fun <T> MotionValue(
    targetState: T,
    modifier: Modifier = Modifier,
    content: @Composable (T) -> Unit
) {
    AnimatedContent(
        targetState = targetState,
        modifier = modifier,
        transitionSpec = {
            (fadeIn(tween(RPMotion.Fast, easing = RPMotion.EaseOut)) +
                slideInVertically(tween(RPMotion.Fast, easing = RPMotion.EaseOut)) { it / 3 }) togetherWith
                (fadeOut(tween(RPMotion.Quick)) +
                    slideOutVertically(tween(RPMotion.Quick)) { -it / 4 })
        },
        label = "value-motion"
    ) { value ->
        content(value)
    }
}
