package br.com.rpdoces.admin.ui

import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.calculateBottomPadding as composeCalculateBottomPadding
import androidx.compose.ui.unit.Dp

/**
 * Ponte de compatibilidade para o calculateBottomPadding usado pelo shell nativo.
 * Mantém RPApp independente da forma como a extensão é exposta pela versão atual do Compose.
 */
internal fun PaddingValues.calculateBottomPadding(): Dp = composeCalculateBottomPadding()
