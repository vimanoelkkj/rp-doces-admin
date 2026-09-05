package androidx.compose.animation.core

import androidx.compose.animation.animateColorAsState as composeAnimateColorAsState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.State
import androidx.compose.ui.graphics.Color

/**
 * Compatibility bridge for the Compose version used by this project.
 * animateColorAsState lives in androidx.compose.animation, while a few
 * motion call sites import it from animation.core.
 */
@Composable
fun animateColorAsState(
    targetValue: Color,
    animationSpec: AnimationSpec<Color>,
    label: String = "ColorAnimation"
): State<Color> = composeAnimateColorAsState(
    targetValue = targetValue,
    animationSpec = animationSpec,
    label = label
)
