package br.com.rpdoces.admin.ui.remote

import androidx.compose.runtime.staticCompositionLocalOf
import br.com.rpdoces.admin.data.remote.AppRemoteConfig

/**
 * Configuração remota atualmente aplicada ao app.
 * Qualquer tela Compose pode ler este valor sem acoplamento ao polling/rede.
 */
val LocalAppRemoteConfig = staticCompositionLocalOf { AppRemoteConfig() }
