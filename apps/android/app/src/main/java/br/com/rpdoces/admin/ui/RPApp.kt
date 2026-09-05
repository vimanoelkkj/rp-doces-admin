package br.com.rpdoces.admin.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AdminPanelSettings
import androidx.compose.material.icons.outlined.Inventory2
import androidx.compose.material.icons.outlined.ReceiptLong
import androidx.compose.material.icons.outlined.SpaceDashboard
import androidx.compose.material.icons.outlined.Storefront
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import br.com.rpdoces.admin.data.auth.AuthRepository
import br.com.rpdoces.admin.data.auth.AuthUser
import br.com.rpdoces.admin.ui.auth.AuthUiState
import br.com.rpdoces.admin.ui.auth.AuthViewModel

private enum class MainTab(
    val label: String,
    val icon: ImageVector
) {
    Dashboard("Dashboard", Icons.Outlined.SpaceDashboard),
    Produtos("Produtos", Icons.Outlined.Inventory2),
    Pedidos("Pedidos", Icons.Outlined.ReceiptLong),
    Admins("Admins", Icons.Outlined.AdminPanelSettings),
    Loja("Loja", Icons.Outlined.Storefront)
}

@Composable
fun RPApp(repository: AuthRepository) {
    val authViewModel: AuthViewModel = viewModel(factory = AuthViewModel.factory(repository))
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

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun MainShell(
    user: AuthUser,
    onLogout: () -> Unit
) {
    var selected by rememberSaveable { mutableStateOf(MainTab.Dashboard) }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(selected.label, fontWeight = FontWeight.Bold)
                        Text(
                            text = user.nome,
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                },
                actions = {
                    Button(
                        onClick = onLogout,
                        modifier = Modifier.padding(end = 8.dp)
                    ) {
                        Text("Sair")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surface
                )
            )
        },
        bottomBar = {
            NavigationBar(
                containerColor = MaterialTheme.colorScheme.surface
            ) {
                MainTab.entries.forEach { tab ->
                    NavigationBarItem(
                        selected = selected == tab,
                        onClick = { selected = tab },
                        icon = { Icon(tab.icon, contentDescription = tab.label) },
                        label = { Text(tab.label) },
                        colors = NavigationBarItemDefaults.colors(
                            indicatorColor = MaterialTheme.colorScheme.primaryContainer
                        )
                    )
                }
            }
        }
    ) { padding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(20.dp),
            contentAlignment = Alignment.Center
        ) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Icon(
                    imageVector = selected.icon,
                    contentDescription = null,
                    modifier = Modifier.size(42.dp),
                    tint = MaterialTheme.colorScheme.primary
                )
                Text(
                    text = selected.label,
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.Bold
                )
                Text(
                    text = "Estrutura nativa pronta. Esta tela será conectada à API na próxima etapa.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodyMedium
                )
            }
        }
    }
}
