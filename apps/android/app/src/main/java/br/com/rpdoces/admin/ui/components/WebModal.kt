package br.com.rpdoces.admin.ui.components

import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.OffsetMapping
import androidx.compose.ui.text.input.TransformedText
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import br.com.rpdoces.admin.ui.theme.LocalRPWebColors

private val webEmojiOptions = listOf(
    "🍰", "🧁", "🍮", "🎂", "🍓",
    "🍫", "🥥", "🍋", "🍯", "🍪",
    "🍒", "🍎", "🍊", "🍌", "🍍",
    "🥝", "🫐", "🍇", "🍑", "🥭",
    "☕", "🥛", "🍦", "🍨", "🍧"
)

@Composable
fun WebModal(
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
    maxWidth: Int = 480,
    scrollable: Boolean = true,
    content: @Composable ColumnScope.() -> Unit
) {
    val web = LocalRPWebColors.current
    var entered by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { entered = true }

    val alpha by animateFloatAsState(
        targetValue = if (entered) 1f else 0f,
        animationSpec = tween(RPMotion.Fast, easing = RPMotion.EaseOut),
        label = "modal-alpha"
    )
    val scale by animateFloatAsState(
        targetValue = if (entered) 1f else .975f,
        animationSpec = tween(RPMotion.Normal, easing = RPMotion.EaseOut),
        label = "modal-scale"
    )
    val lift by animateDpAsState(
        targetValue = if (entered) 0.dp else 18.dp,
        animationSpec = tween(RPMotion.Normal, easing = RPMotion.EaseOut),
        label = "modal-lift"
    )

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false)
    ) {
        BoxWithConstraints(modifier = Modifier.fillMaxWidth()) {
            val density = LocalDensity.current
            val bodyModifier = Modifier
                .fillMaxWidth()
                .padding(8.dp)
                .widthIn(max = maxWidth.dp)
                .heightIn(max = maxHeight * .92f)

            Surface(
                modifier = modifier
                    .then(bodyModifier)
                    .graphicsLayer {
                        this.alpha = alpha
                        scaleX = scale
                        scaleY = scale
                        translationY = with(density) { lift.toPx() }
                    }
                    .align(Alignment.BottomCenter),
                shape = RoundedCornerShape(14.dp),
                color = web.surface,
                border = BorderStroke(1.dp, web.border),
                shadowElevation = 18.dp
            ) {
                val scroll = rememberScrollState()
                Column(
                    modifier = if (scrollable) {
                        Modifier.verticalScroll(scroll).padding(22.dp)
                    } else {
                        Modifier.padding(22.dp)
                    },
                    content = content
                )
            }
        }
    }
}

@Composable
fun WebModalHeader(
    kicker: String,
    title: String,
    subtitle: String? = null,
    onClose: () -> Unit
) {
    val web = LocalRPWebColors.current
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(14.dp),
        verticalAlignment = Alignment.Top
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                kicker.uppercase(),
                color = web.accentDark,
                fontSize = 10.5.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = .4.sp
            )
            Text(
                title,
                color = web.text,
                fontSize = 18.sp,
                lineHeight = 23.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.padding(top = 3.dp)
            )
            if (!subtitle.isNullOrBlank()) {
                Text(
                    subtitle,
                    color = web.muted,
                    fontSize = 11.5.sp,
                    lineHeight = 17.sp,
                    modifier = Modifier.padding(top = 6.dp)
                )
            }
        }
        Surface(
            onClick = onClose,
            modifier = Modifier.height(32.dp),
            shape = RoundedCornerShape(8.dp),
            color = web.surface,
            border = BorderStroke(1.dp, web.border)
        ) {
            Box(modifier = Modifier.padding(horizontal = 7.dp), contentAlignment = Alignment.Center) {
                Icon(Icons.Outlined.Close, contentDescription = "Fechar", tint = web.muted)
            }
        }
    }
    Spacer(Modifier.height(18.dp))
}

@Composable
fun WebField(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    placeholder: String = "",
    singleLine: Boolean = true,
    minHeight: Int = 40,
    visualTransformation: VisualTransformation = VisualTransformation.None,
    enabled: Boolean = true,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default
) {
    if (label.equals("Emoji", ignoreCase = true)) {
        WebEmojiPickerField(
            label = label,
            value = value,
            onValueChange = onValueChange,
            modifier = modifier,
            enabled = enabled
        )
        return
    }

    if (label.equals("Preço", ignoreCase = true) || label.equals("Preço promocional", ignoreCase = true)) {
        WebCurrencyField(
            label = label,
            value = value,
            onValueChange = onValueChange,
            modifier = modifier,
            enabled = enabled
        )
        return
    }

    val web = LocalRPWebColors.current
    Column(modifier = modifier) {
        Text(label.uppercase(), color = web.muted, fontSize = 10.5.sp, fontWeight = FontWeight.Bold, letterSpacing = .4.sp)
        Spacer(Modifier.height(8.dp))
        Surface(
            modifier = Modifier.fillMaxWidth().heightIn(min = minHeight.dp),
            shape = RoundedCornerShape(9.dp),
            color = web.surface,
            border = BorderStroke(1.dp, web.borderStrong)
        ) {
            BasicTextField(
                value = value,
                onValueChange = onValueChange,
                enabled = enabled,
                singleLine = singleLine,
                visualTransformation = visualTransformation,
                keyboardOptions = keyboardOptions,
                textStyle = TextStyle(
                    color = if (enabled) web.text else web.muted,
                    fontSize = 12.5.sp,
                    fontWeight = FontWeight.Medium,
                    lineHeight = 18.sp
                ),
                modifier = Modifier.fillMaxWidth().padding(
                    horizontal = 12.dp,
                    vertical = if (singleLine) 11.dp else 10.dp
                ),
                decorationBox = { inner ->
                    Box {
                        if (value.isBlank() && placeholder.isNotBlank()) {
                            Text(placeholder, color = web.muted, fontSize = 12.5.sp)
                        }
                        inner()
                    }
                }
            )
        }
    }
}

@Composable
private fun WebCurrencyField(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier,
    enabled: Boolean
) {
    val web = LocalRPWebColors.current
    var focused by remember { mutableStateOf(false) }
    var rawDigits by remember { mutableStateOf(currencyDigitsFromFormatted(value)) }

    LaunchedEffect(value, focused) {
        if (!focused) rawDigits = currencyDigitsFromFormatted(value)
    }

    Column(modifier = modifier) {
        Text(label.uppercase(), color = web.muted, fontSize = 10.5.sp, fontWeight = FontWeight.Bold, letterSpacing = .4.sp)
        Spacer(Modifier.height(8.dp))
        Surface(
            modifier = Modifier.fillMaxWidth().heightIn(min = 40.dp),
            shape = RoundedCornerShape(9.dp),
            color = web.surface,
            border = BorderStroke(1.dp, web.borderStrong)
        ) {
            BasicTextField(
                value = rawDigits,
                onValueChange = { typed ->
                    val digits = typed.filter(Char::isDigit).take(9)
                    val sanitized = digits.trimStart('0').ifBlank {
                        if (digits.isNotEmpty()) "0" else ""
                    }
                    rawDigits = sanitized
                    onValueChange(sanitized)
                },
                enabled = enabled,
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                visualTransformation = CurrencyCentsVisualTransformation,
                textStyle = TextStyle(
                    color = if (enabled) web.text else web.muted,
                    fontSize = 12.5.sp,
                    fontWeight = FontWeight.Medium,
                    lineHeight = 18.sp
                ),
                modifier = Modifier
                    .fillMaxWidth()
                    .onFocusChanged { state ->
                        focused = state.isFocused
                        if (!state.isFocused) {
                            rawDigits = currencyDigitsFromFormatted(value)
                        }
                    }
                    .padding(horizontal = 12.dp, vertical = 11.dp),
                decorationBox = { inner ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            "R$ ",
                            color = if (enabled) web.text else web.muted,
                            fontSize = 12.5.sp,
                            fontWeight = FontWeight.Medium
                        )
                        Box(modifier = Modifier.weight(1f)) {
                            if (rawDigits.isBlank()) {
                                Text("0,00", color = web.muted, fontSize = 12.5.sp)
                            }
                            inner()
                        }
                    }
                }
            )
        }
    }
}

private object CurrencyCentsVisualTransformation : VisualTransformation {
    override fun filter(text: AnnotatedString): TransformedText {
        val raw = text.text.filter(Char::isDigit)
        if (raw.isBlank()) {
            return TransformedText(AnnotatedString(""), OffsetMapping.Identity)
        }

        val transformed = formatCentsDigits(raw)
        val transformedDigitPositions = transformed.indices.filter { transformed[it].isDigit() }
        val originalDigitPositions = transformedDigitPositions.takeLast(raw.length)

        val boundaries = IntArray(raw.length + 1)
        boundaries[0] = originalDigitPositions.firstOrNull() ?: 0
        for (index in raw.indices) {
            boundaries[index + 1] = (originalDigitPositions.getOrNull(index)?.plus(1) ?: transformed.length)
        }

        val mapping = object : OffsetMapping {
            override fun originalToTransformed(offset: Int): Int =
                boundaries[offset.coerceIn(0, raw.length)].coerceIn(0, transformed.length)

            override fun transformedToOriginal(offset: Int): Int {
                val target = offset.coerceIn(0, transformed.length)
                var best = 0
                boundaries.forEachIndexed { index, boundary ->
                    if (boundary <= target) best = index
                }
                return best.coerceIn(0, raw.length)
            }
        }

        return TransformedText(AnnotatedString(transformed), mapping)
    }
}

private fun formatCentsDigits(raw: String): String {
    val digits = raw.filter(Char::isDigit).trimStart('0').ifBlank { "0" }
    val padded = digits.padStart(3, '0')
    val cents = padded.takeLast(2)
    val reais = padded.dropLast(2).trimStart('0').ifBlank { "0" }
    return "${groupThousands(reais)},$cents"
}

private fun groupThousands(value: String): String {
    if (value.length <= 3) return value
    val firstGroup = value.length % 3
    return buildString {
        var index = 0
        if (firstGroup > 0) {
            append(value.substring(0, firstGroup))
            index = firstGroup
            if (index < value.length) append('.')
        }
        while (index < value.length) {
            append(value.substring(index, (index + 3).coerceAtMost(value.length)))
            index += 3
            if (index < value.length) append('.')
        }
    }
}

private fun currencyDigitsFromFormatted(formatted: String): String {
    val digits = formatted.filter(Char::isDigit).trimStart('0')
    return digits.take(9)
}

@Composable
private fun WebEmojiPickerField(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier,
    enabled: Boolean
) {
    val web = LocalRPWebColors.current
    var open by remember { mutableStateOf(false) }

    Column(modifier = modifier) {
        Text(label.uppercase(), color = web.muted, fontSize = 10.5.sp, fontWeight = FontWeight.Bold, letterSpacing = .4.sp)
        Spacer(Modifier.height(8.dp))
        Box {
            Surface(
                onClick = { if (enabled) open = true },
                enabled = enabled,
                modifier = Modifier.fillMaxWidth().height(40.dp),
                shape = RoundedCornerShape(9.dp),
                color = web.surface,
                border = BorderStroke(1.dp, web.borderStrong)
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Text(value.ifBlank { "🍰" }, color = if (enabled) web.text else web.muted, fontSize = 20.sp)
                    MotionChevron(expanded = open, tint = web.muted, modifier = Modifier.size(16.dp))
                }
            }

            MotionDropdownMenu(
                expanded = open,
                onDismissRequest = { open = false }
            ) {
                Column(
                    modifier = Modifier.padding(8.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    webEmojiOptions.chunked(5).forEach { options ->
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            options.forEach { option ->
                                val selected = option == value
                                Surface(
                                    onClick = {
                                        onValueChange(option)
                                        open = false
                                    },
                                    modifier = Modifier.size(38.dp),
                                    shape = RoundedCornerShape(9.dp),
                                    color = if (selected) web.accentSoft else web.surface,
                                    border = BorderStroke(1.dp, if (selected) web.accent else web.border)
                                ) {
                                    Box(contentAlignment = Alignment.Center) {
                                        Text(option, fontSize = 18.sp)
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun WebModalActions(
    primaryText: String,
    onPrimary: () -> Unit,
    secondaryText: String = "Cancelar",
    onSecondary: () -> Unit,
    primaryDanger: Boolean = false,
    busy: Boolean = false
) {
    val web = LocalRPWebColors.current
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(20.dp, Alignment.End),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Surface(onClick = onSecondary, enabled = !busy, color = Color.Transparent) {
            Text(
                secondaryText,
                color = web.muted,
                fontSize = 12.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.padding(vertical = 10.dp)
            )
        }
        Surface(
            onClick = onPrimary,
            enabled = !busy,
            color = Color.Transparent
        ) {
            MotionValue(targetState = if (busy) "Salvando…" else primaryText) { label ->
                Text(
                    label,
                    color = if (primaryDanger) web.danger else web.accentDark,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.padding(vertical = 10.dp)
                )
            }
        }
    }
}
