package br.com.rpdoces.admin.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.layout.windowInsetsTopHeight
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ReceiptLong
import androidx.compose.material.icons.outlined.AdminPanelSettings
import androidx.compose.material.icons.outlined.Inventory2
import androidx.compose.material.icons.outlined.NotificationsNone
import androidx.compose.material.icons.outlined.SpaceDashboard
import androidx.compose.material.icons.outlined.Storefront
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import br.com.rpdoces.admin.BuildConfig
import br.com.rpdoces.admin.data.auth.AuthRepository
import br.com.rpdoces.admin.data.auth.AuthUser
import br.com.rpdoces.admin.data.dashboard.DashboardRepository
import br.com.rpdoces.admin.ui.auth.AuthUiState
import br.com.rpdoces.admin.ui.auth.AuthViewModel
import br.com.rpdoces.admin.ui.dashboard.DashboardScreen
import coil3.compose.AsyncImage

private enum class MainTab(
    val label: String,
    val mobileLabel: String,
    val subtitle: String,
    val icon: ImageVector
) {
    Dashboard("Dashboard", "Dashboard", "Visão geral da operação", Icons.Outlined.SpaceDashboard),
    Produtos("Produtos", "Produtos", "Gerencie o catálogo", Icons.Outlined.Inventory2),
    Pedidos("Pedidos", "Pedidos", "Acompanhe a operação", Icons.AutoMirrored.Outlined.ReceiptLong),
    Admins("Administradores", "Admins", "Gerencie os acessos", Icons.Outlined.AdminPanelSettings),
    Loja("Loja", "Loja", "Configurações da loja", Icons.Outlined.Storefront)
}

@Composable
fun RPApp(
    authRepository: AuthRepository,
    dashboardRepository: DashboardRepository
) {
    val authViewModel: AuthViewModel = viewModel(factory = AuthViewModel.factory(authRepository))
    val state by authViewModel.state.collectAsStateWithLifecycle()

    when (val current = state) {
        AuthUiState.Loading -> LoadingScreen()
        is AuthUiState.SignedOut -> LoginScreen(
            submitting = current.submitting,
            error = current.error,
            onLogin = authViewModel::login
        )
        is AuthUiState.SignedIn -> MainShell(
            user = current.user,
            dashboardRepository = dashboardRepository,
            onLogout = authViewModel::logout
        )
    }
}

@Composable
private fun LoadingScreen() {
    Box(
        modifier = Modifier.fillMaxSize(),
        contentAlignment = Alignment.Center
    ) {
        CircularProgressIndicator()
    }
}

@Composable
private fun LoginScreen(
    submitting: Boolean,
    error: String?,
    onLogin: (String, String) -> Unit
) {
    var username by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    val focusManager = LocalFocusManager.current

    Surface(
        modifier = Modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.background
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 24.dp),
            contentAlignment = Alignment.Center
        ) {
            Surface(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(24.dp),
                color = MaterialTheme.colorScheme.surface,
                tonalElevation = 1.dp
            ) {
                Column(
                    modifier = Modifier.padding(24.dp),
                    verticalArrangement = Arrangement.spacedBy(16.dp)
                ) {
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(
                            text = "R&P Doces",
                            style = MaterialTheme.typography.headlineMedium,
                            fontWeight = FontWeight.Bold
                        )
                        Text(
                            text = "Painel administrativo",
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }

                    HorizontalDivider(color = MaterialTheme.colorScheme.outline)

                    OutlinedTextField(
                        value = username,
                        onValueChange = { username = it },
                        modifier = Modifier.fillMaxWidth(),
                        enabled = !submitting,
                        singleLine = true,
                        label = { Text("Usuário") },
                        keyboardOptions = KeyboardOptions(
                            keyboardType = KeyboardType.Text,
                            imeAction = ImeAction.Next
                        )
                    )

                    OutlinedTextField(
                        value = password,
                        onValueChange = { password = it },
                        modifier = Modifier.fillMaxWidth(),
                        enabled = !submitting,
                        singleLine = true,
                        label = { Text("Senha") },
                        visualTransformation = PasswordVisualTransformation(),
                        keyboardOptions = KeyboardOptions(
                            keyboardType = KeyboardType.Password,
                            imeAction = ImeAction.Done
                        ),
                        keyboardActions = KeyboardActions(
                            onDone = {
                                focusManager.clearFocus()
                                if (!submitting) onLogin(username, password)
                            }
                        )
                    )

                    if (error != null) {
                        Text(
                            text = error,
                            color = MaterialTheme.colorScheme.error,
                            style = MaterialTheme.typography.bodyMedium
                        )
                    }

                    Button(
                        onClick = {
                            focusManager.clearFocus()
                            onLogin(username, password)
                        },
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(52.dp),
                        enabled = !submitting
                    ) {
                        if (submitting) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(20.dp),
                                strokeWidth = 2.dp,
                                color = MaterialTheme.colorScheme.onPrimary
                            )
                            Spacer(Modifier.width(10.dp))
                            Text("Entrando…")
                        } else {
                            Text("Entrar")
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun MainShell(
    user: AuthUser,
    dashboardRepository: DashboardRepository,
    onLogout: () -> Unit
) {
    var selected by rememberSaveable { mutableStateOf(MainTab.Dashboard) }
    var profileOpen by rememberSaveable { mutableStateOf(false) }

    AppBackground {
        Scaffold(
            containerColor = Color.Transparent,
            topBar = {
                MobileHeader(
                    tab = selected,
                    user = user,
                    profileOpen = profileOpen,
                    onProfileOpenChange = { profileOpen = it },
                    onLogout = onLogout
                )
            },
            bottomBar = {
                MobileBottomBar(
                    selected = selected,
                    onSelected = { selected = it }
                )
            }
        ) { padding ->
            when (selected) {
                MainTab.Dashboard -> DashboardScreen(
                    repository = dashboardRepository,
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(padding)
                )
                else -> PlaceholderScreen(
                    tab = selected,
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(padding)
                )
            }
        }
    }
}

@Composable
private fun AppBackground(content: @Composable () -> Unit) {
    BoxWithConstraints(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
    ) {
        val density = LocalDensity.current
        val widthPx = with(density) { maxWidth.toPx() }
        val heightPx = with(density) { maxHeight.toPx() }
        val dark = MaterialTheme.colorScheme.background == Color(0xFF1B1614)
        val first = if (dark) Color(0x24783C32) else Color(0x3DF4DFD7)
        val second = if (dark) Color(0x1A643732) else Color(0x29F2DCD8)

        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(
                    Brush.radialGradient(
                        colors = listOf(first, Color.Transparent),
                        center = Offset(widthPx * .16f, heightPx * .08f),
                        radius = widthPx * .72f
                    )
                )
        )
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(
                    Brush.radialGradient(
                        colors = listOf(second, Color.Transparent),
                        center = Offset(widthPx * .94f, heightPx * .14f),
                        radius = widthPx * .62f
                    )
                )
        )
        content()
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .windowInsetsTopHeight(WindowInsets.statusBars)
                .background(MaterialTheme.colorScheme.primary)
                .align(Alignment.TopCenter)
        )
    }
}

@Composable
private fun MobileHeader(
    tab: MainTab,
    user: AuthUser,
    profileOpen: Boolean,
    onProfileOpenChange: (Boolean) -> Unit,
    onLogout: () -> Unit
) {
    Surface(
        color = Color.Transparent,
        shadowElevation = 0.dp
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .windowInsetsPadding(WindowInsets.statusBars)
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(start = 14.dp, end = 12.dp, top = 12.dp, bottom = 14.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column(
                    modifier = Modifier.weight(1f),
                    verticalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    Text(
                        text = tab.label,
                        color = MaterialTheme.colorScheme.onBackground,
                        fontSize = 25.sp,
                        lineHeight = 30.sp,
                        fontWeight = FontWeight.Bold,
                        letterSpacing = (-0.8).sp
                    )
                    Text(
                        text = tab.subtitle,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        fontSize = 11.5.sp,
                        lineHeight = 16.sp
                    )
                }

                Row(
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Box(modifier = Modifier.size(40.dp)) {
                        Surface(
                            modifier = Modifier.fillMaxSize(),
                            shape = RoundedCornerShape(12.dp),
                            color = MaterialTheme.colorScheme.surface,
                            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline)
                        ) {
                            IconButton(onClick = { }) {
                                Icon(
                                    imageVector = Icons.Outlined.NotificationsNone,
                                    contentDescription = "Notificações",
                                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                    modifier = Modifier.size(18.dp)
                                )
                            }
                        }
                        Box(
                            modifier = Modifier
                                .padding(top = 6.dp, end = 6.dp)
                                .size(7.dp)
                                .background(MaterialTheme.colorScheme.primary, RoundedCornerShape(99.dp))
                                .align(Alignment.TopEnd)
                        )
                    }

                    Box {
                        Surface(
                            onClick = { onProfileOpenChange(true) },
                            modifier = Modifier.size(40.dp),
                            shape = RoundedCornerShape(12.dp),
                            color = MaterialTheme.colorScheme.surface,
                            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline)
                        ) {
                            Box(contentAlignment = Alignment.Center) {
                                val avatar = avatarModel(user.avatarUrl)
                                if (avatar != null) {
                                    AsyncImage(
                                        model = avatar,
                                        contentDescription = user.nome,
                                        modifier = Modifier.size(32.dp),
                                        contentScale = ContentScale.Crop
                                    )
                                } else {
                                    Surface(
                                        modifier = Modifier.size(32.dp),
                                        shape = RoundedCornerShape(16.dp),
                                        color = MaterialTheme.colorScheme.primaryContainer
                                    ) {
                                        Box(contentAlignment = Alignment.Center) {
                                            Text(
                                                text = userInitials(user.nome),
                                                color = MaterialTheme.colorScheme.primary,
                                                fontSize = 10.5.sp,
                                                fontWeight = FontWeight.Bold
                                            )
                                        }
                                    }
                                }
                            }
                        }

                        DropdownMenu(
                            expanded = profileOpen,
                            onDismissRequest = { onProfileOpenChange(false) }
                        ) {
                            DropdownMenuItem(
                                text = {
                                    Column {
                                        Text(user.nome, fontWeight = FontWeight.Bold)
                                        Text(
                                            user.email.orEmpty(),
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                            fontSize = 10.5.sp
                                        )
                                    }
                                },
                                onClick = { }
                            )
                            HorizontalDivider()
                            DropdownMenuItem(
                                text = { Text("Sair", fontSize = 11.5.sp, fontWeight = FontWeight.SemiBold) },
                                onClick = {
                                    onProfileOpenChange(false)
                                    onLogout()
                                }
                            )
                        }
                    }
                }
            }
            HorizontalDivider(color = MaterialTheme.colorScheme.outline)
        }
    }
}

@Composable
private fun MobileBottomBar(
    selected: MainTab,
    onSelected: (MainTab) -> Unit
) {
    Surface(
        color = MaterialTheme.colorScheme.surface,
        shadowElevation = 0.dp
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .windowInsetsPadding(WindowInsets.navigationBars)
        ) {
            HorizontalDivider(color = MaterialTheme.colorScheme.outline)
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(56.dp)
                    .padding(start = 5.dp, end = 5.dp, top = 4.dp)
            ) {
                MainTab.entries.forEach { tab ->
                    val active = selected == tab
                    Box(
                        modifier = Modifier
                            .weight(1f)
                            .height(52.dp)
                            .clickable { onSelected(tab) }
                            .padding(horizontal = 2.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        Box(
                            modifier = Modifier
                                .align(Alignment.TopCenter)
                                .width(22.dp)
                                .height(2.dp)
                                .background(
                                    if (active) MaterialTheme.colorScheme.primary else Color.Transparent,
                                    RoundedCornerShape(99.dp)
                                )
                        )
                        Column(
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.spacedBy(2.dp)
                        ) {
                            Box(
                                modifier = Modifier.size(21.dp),
                                contentAlignment = Alignment.Center
                            ) {
                                Icon(
                                    imageVector = tab.icon,
                                    contentDescription = tab.label,
                                    modifier = Modifier.size(18.dp),
                                    tint = if (active) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                            Text(
                                text = tab.mobileLabel,
                                color = if (active) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                                fontSize = 8.75.sp,
                                lineHeight = 11.sp,
                                fontWeight = if (active) FontWeight.Bold else FontWeight.Medium,
                                maxLines = 1
                            )
                        }
                    }
                }
            }
        }
    }
}

private fun avatarModel(value: String?): String? {
    val raw = value?.trim().orEmpty()
    if (raw.isBlank()) return null
    return when {
        raw.startsWith("http://") || raw.startsWith("https://") -> raw
        raw.startsWith("/") -> BuildConfig.API_ORIGIN + raw
        else -> BuildConfig.API_ORIGIN + "/" + raw
    }
}

private fun userInitials(name: String): String {
    val parts = name.trim().split(Regex("\\s+")).filter { it.isNotBlank() }
    if (parts.isEmpty()) return "RP"
    return parts.take(2).joinToString("") { it.first().uppercase() }
}

@Composable
private fun PlaceholderScreen(tab: MainTab, modifier: Modifier = Modifier) {
    Box(
        modifier = modifier.padding(20.dp),
        contentAlignment = Alignment.Center
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Icon(
                imageVector = tab.icon,
                contentDescription = null,
                modifier = Modifier.size(42.dp),
                tint = MaterialTheme.colorScheme.primary
            )
            Text(
                text = tab.label,
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Bold
            )
            Text(
                text = "Esta área será portada para Compose nas próximas etapas.",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodyMedium
            )
        }
    }
}
