package br.com.rpdoces.admin.ui

import android.content.Context
import android.content.ContextWrapper
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Fingerprint
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import br.com.rpdoces.admin.BuildConfig
import br.com.rpdoces.admin.data.admins.AdminsRepository
import br.com.rpdoces.admin.data.auth.AuthRepository
import br.com.rpdoces.admin.data.auth.AuthUser
import br.com.rpdoces.admin.data.auth.IdentifiedUser
import br.com.rpdoces.admin.data.dashboard.DashboardRepository
import br.com.rpdoces.admin.data.orders.OrdersRepository
import br.com.rpdoces.admin.data.products.ProductsRepository
import br.com.rpdoces.admin.data.store.StoreRepository
import br.com.rpdoces.admin.security.NativeBiometricAuth
import br.com.rpdoces.admin.ui.auth.AuthUiState
import br.com.rpdoces.admin.ui.auth.AuthViewModel
import br.com.rpdoces.admin.ui.theme.LocalRPWebColors
import coil3.compose.AsyncImage
import kotlin.math.max

private const val BACKGROUND_LOCK_TIMEOUT_MS = 30_000L

@Composable
fun BiometricRPApp(
    authRepository: AuthRepository,
    dashboardRepository: DashboardRepository,
    productsRepository: ProductsRepository,
    ordersRepository: OrdersRepository,
    adminsRepository: AdminsRepository,
    storeRepository: StoreRepository
) {
    val authViewModel: AuthViewModel = viewModel(factory = AuthViewModel.factory(authRepository))
    val state by authViewModel.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val activity = remember(context) { context.findFragmentActivity() }
    val biometricAvailable = remember(context) { NativeBiometricAuth.isAvailable(context) }
    var unlockedUserId by rememberSaveable { mutableStateOf<Int?>(null) }
    var stoppedAt by remember { mutableLongStateOf(0L) }

    LaunchedEffect(state) {
        val signed = state as? AuthUiState.SignedIn ?: return@LaunchedEffect
        if (!signed.restored || !biometricAvailable) unlockedUserId = signed.user.id
    }

    DisposableEffect(activity, biometricAvailable, state) {
        if (activity == null || !biometricAvailable) return@DisposableEffect onDispose { }
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_STOP -> stoppedAt = System.currentTimeMillis()
                Lifecycle.Event.ON_START -> {
                    val signed = state as? AuthUiState.SignedIn
                    if (signed != null && stoppedAt > 0L && System.currentTimeMillis() - stoppedAt >= BACKGROUND_LOCK_TIMEOUT_MS) {
                        unlockedUserId = null
                    }
                }
                else -> Unit
            }
        }
        activity.lifecycle.addObserver(observer)
        onDispose { activity.lifecycle.removeObserver(observer) }
    }

    when (val current = state) {
        AuthUiState.Loading -> LoginLoading()
        is AuthUiState.SignedOut -> ExactLoginScreen(
            state = current,
            onIdentify = authViewModel::identify,
            onLogin = { password ->
                current.identifiedUser?.let { authViewModel.login(it.username, password) }
            },
            onSwitchUser = authViewModel::switchUser
        )
        is AuthUiState.SignedIn -> {
            val unlocked = unlockedUserId == current.user.id || !biometricAvailable
            if (!unlocked && activity != null) {
                BiometricUnlockScreen(
                    user = current.user,
                    activity = activity,
                    onUnlocked = { unlockedUserId = current.user.id },
                    onUsePassword = authViewModel::logout
                )
            } else {
                RPApp(
                    authRepository = authRepository,
                    dashboardRepository = dashboardRepository,
                    productsRepository = productsRepository,
                    ordersRepository = ordersRepository,
                    adminsRepository = adminsRepository,
                    storeRepository = storeRepository
                )
            }
        }
    }
}

@Composable
private fun LoginLoading() {
    val web = LocalRPWebColors.current
    LoginBackdrop {
        Surface(
            modifier = Modifier.fillMaxWidth().widthIn(max = 430.dp),
            shape = RoundedCornerShape(14.dp),
            color = web.surfaceVeilThree,
            border = BorderStroke(1.dp, web.border)
        ) {
            Row(
                modifier = Modifier.padding(26.dp),
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically
            ) {
                CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp, color = web.accent)
                Spacer(Modifier.width(10.dp))
                Text("Verificando sessão…", color = web.muted, fontSize = 13.sp)
            }
        }
    }
}

@Composable
private fun ExactLoginScreen(
    state: AuthUiState.SignedOut,
    onIdentify: (String) -> Unit,
    onLogin: (String) -> Unit,
    onSwitchUser: () -> Unit
) {
    val web = LocalRPWebColors.current
    var username by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable(state.identifiedUser?.username) { mutableStateOf("") }
    val focusManager = LocalFocusManager.current
    val identified = state.identifiedUser

    LoginBackdrop {
        Surface(
            modifier = Modifier.fillMaxWidth().widthIn(max = 430.dp),
            shape = RoundedCornerShape(14.dp),
            color = web.surfaceVeilThree,
            border = BorderStroke(1.dp, web.border),
            shadowElevation = 18.dp
        ) {
            Column(modifier = Modifier.padding(horizontal = 20.dp, vertical = 25.dp)) {
                BrandRow()
                Spacer(Modifier.height(22.dp))
                LoginHeading()

                if (identified == null) {
                    LoginField(
                        label = "Usuário",
                        value = username,
                        onValueChange = { username = it },
                        enabled = !state.submitting,
                        keyboardType = KeyboardType.Text,
                        imeAction = ImeAction.Done,
                        onDone = {
                            focusManager.clearFocus()
                            if (!state.submitting && username.isNotBlank()) onIdentify(username)
                        }
                    )
                    Spacer(Modifier.height(14.dp))
                    LoginSubmit(
                        text = if (state.submitting) "Procurando…" else "Continuar",
                        enabled = !state.submitting && username.isNotBlank(),
                        onClick = {
                            focusManager.clearFocus()
                            onIdentify(username)
                        }
                    )
                } else {
                    LoginIdentity(identified)
                    LoginField(
                        label = "Senha",
                        value = password,
                        onValueChange = { password = it },
                        enabled = !state.submitting,
                        password = true,
                        keyboardType = KeyboardType.Password,
                        imeAction = ImeAction.Done,
                        onDone = {
                            focusManager.clearFocus()
                            if (!state.submitting && password.isNotBlank()) onLogin(password)
                        }
                    )
                    Spacer(Modifier.height(14.dp))
                    LoginSubmit(
                        text = if (state.submitting) "Entrando…" else "Entrar",
                        enabled = !state.submitting && password.isNotBlank(),
                        onClick = {
                            focusManager.clearFocus()
                            onLogin(password)
                        }
                    )
                    Surface(onClick = onSwitchUser, color = Color.Transparent, modifier = Modifier.align(Alignment.CenterHorizontally)) {
                        Text("Trocar usuário", color = web.accentDark, fontSize = 10.5.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(horizontal = 8.dp, vertical = 12.dp))
                    }
                }

                Text(
                    state.error.orEmpty(),
                    color = if (state.error == null) web.muted else web.danger,
                    fontSize = 11.sp,
                    modifier = Modifier.fillMaxWidth().padding(top = 4.dp),
                    textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                    minLines = 1
                )
                Text(
                    "A biometria é validada pelo Android e não sai do seu aparelho.",
                    color = web.muted,
                    fontSize = 9.5.sp,
                    lineHeight = 14.sp,
                    modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                    textAlign = androidx.compose.ui.text.style.TextAlign.Center
                )
            }
        }
    }
}

@Composable
private fun BiometricUnlockScreen(
    user: AuthUser,
    activity: FragmentActivity,
    onUnlocked: () -> Unit,
    onUsePassword: () -> Unit
) {
    val web = LocalRPWebColors.current
    var status by remember { mutableStateOf("") }
    var promptOpen by remember { mutableStateOf(false) }

    fun authenticate() {
        if (promptOpen) return
        promptOpen = true
        status = "Aguardando a biometria do aparelho…"
        NativeBiometricAuth.authenticate(
            activity = activity,
            onSuccess = {
                promptOpen = false
                status = "Identidade confirmada."
                onUnlocked()
            },
            onError = {
                promptOpen = false
                status = it
            },
            onCancel = {
                promptOpen = false
                status = "Autenticação cancelada."
            }
        )
    }

    LaunchedEffect(user.id) { authenticate() }

    LoginBackdrop {
        Surface(
            modifier = Modifier.fillMaxWidth().widthIn(max = 430.dp),
            shape = RoundedCornerShape(14.dp),
            color = web.surfaceVeilThree,
            border = BorderStroke(1.dp, web.border),
            shadowElevation = 18.dp
        ) {
            Column(modifier = Modifier.padding(horizontal = 20.dp, vertical = 25.dp)) {
                BrandRow()
                Spacer(Modifier.height(22.dp))
                LoginHeading()

                LoginIdentity(user)

                Surface(
                    onClick = { authenticate() },
                    enabled = !promptOpen,
                    modifier = Modifier.fillMaxWidth().height(62.dp),
                    shape = RoundedCornerShape(12.dp),
                    color = web.surfaceSoft,
                    border = BorderStroke(1.dp, web.borderStrong)
                ) {
                    Row(
                        modifier = Modifier.fillMaxSize().padding(horizontal = 13.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(13.dp)
                    ) {
                        Surface(
                            modifier = Modifier.size(40.dp),
                            shape = RoundedCornerShape(10.dp),
                            color = web.surface,
                            border = BorderStroke(1.dp, web.border)
                        ) {
                            Box(contentAlignment = Alignment.Center) {
                                Icon(Icons.Outlined.Fingerprint, contentDescription = null, tint = web.accentDark, modifier = Modifier.size(23.dp))
                            }
                        }
                        Column {
                            Text("Entrar com biometria", color = web.text, fontSize = 13.sp, fontWeight = FontWeight.Bold)
                            Text("Digital ou rosto cadastrados no aparelho", color = web.muted, fontSize = 10.5.sp, modifier = Modifier.padding(top = 3.dp))
                        }
                    }
                }

                Separator("ou use sua senha")
                Surface(onClick = onUsePassword, color = Color.Transparent, modifier = Modifier.align(Alignment.CenterHorizontally)) {
                    Text("Usar senha", color = web.accentDark, fontSize = 10.5.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(horizontal = 10.dp, vertical = 7.dp))
                }

                Text(
                    status,
                    color = if (status.contains("não", ignoreCase = true) || status.contains("cancel", ignoreCase = true)) web.danger else web.muted,
                    fontSize = 11.sp,
                    minLines = 1,
                    modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                    textAlign = androidx.compose.ui.text.style.TextAlign.Center
                )
                Text(
                    "Sua digital ou seu rosto são verificados pelo sistema biométrico nativo do Android.",
                    color = web.muted,
                    fontSize = 9.5.sp,
                    lineHeight = 14.sp,
                    modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                    textAlign = androidx.compose.ui.text.style.TextAlign.Center
                )
            }
        }
    }
}

@Composable
private fun BrandRow() {
    val web = LocalRPWebColors.current
    Row(modifier = Modifier.fillMaxWidth().height(54.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.Top) {
        Text(
            "R&P",
            color = web.accent,
            fontFamily = FontFamily.Serif,
            fontSize = 39.sp,
            lineHeight = 39.sp,
            fontWeight = FontWeight.Normal,
            letterSpacing = (-3).sp
        )
        Surface(shape = RoundedCornerShape(99.dp), color = web.accentSoft, border = BorderStroke(1.dp, web.pinkBorder)) {
            Text("V2", color = web.accentDark, fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = .8.sp, modifier = Modifier.padding(horizontal = 9.dp, vertical = 7.dp))
        }
    }
}

@Composable
private fun LoginHeading() {
    val web = LocalRPWebColors.current
    Text("PAINEL ADMINISTRATIVO", color = web.accentDark, fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.1.sp)
    Text("Bem-vindo de volta", color = web.text, fontSize = 27.sp, lineHeight = 29.sp, fontWeight = FontWeight.Bold, letterSpacing = (-.9).sp, modifier = Modifier.padding(top = 6.dp))
    Text("Entre para gerenciar pedidos, produtos e a loja.", color = web.muted, fontSize = 13.sp, lineHeight = 20.sp, modifier = Modifier.padding(top = 9.dp, bottom = 24.dp))
}

@Composable
private fun LoginIdentity(user: IdentifiedUser) {
    LoginIdentity(name = user.nome.ifBlank { user.username }, username = user.username, avatarUrl = user.avatarUrl)
}

@Composable
private fun LoginIdentity(user: AuthUser) {
    LoginIdentity(name = user.nome.ifBlank { user.username }, username = user.username, avatarUrl = user.avatarUrl)
}

@Composable
private fun LoginIdentity(name: String, username: String, avatarUrl: String?) {
    val web = LocalRPWebColors.current
    Column(modifier = Modifier.fillMaxWidth().padding(bottom = 20.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Surface(
            modifier = Modifier.size(72.dp),
            shape = RoundedCornerShape(50),
            color = web.accent,
            border = BorderStroke(1.dp, web.pinkBorder),
            shadowElevation = 8.dp
        ) {
            val model = avatarModelForLogin(avatarUrl)
            if (model != null) {
                AsyncImage(model = model, contentDescription = name, modifier = Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
            } else {
                Box(contentAlignment = Alignment.Center) { Text(initialsForLogin(name), color = Color.White, fontSize = 20.sp, fontWeight = FontWeight.Bold) }
            }
        }
        Text(name, color = web.text, fontSize = 14.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 12.dp), maxLines = 1)
        Text("@$username", color = web.muted, fontSize = 10.5.sp, modifier = Modifier.padding(top = 3.dp))
    }
}

@Composable
private fun LoginField(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    enabled: Boolean,
    password: Boolean = false,
    keyboardType: KeyboardType,
    imeAction: ImeAction,
    onDone: () -> Unit
) {
    val web = LocalRPWebColors.current
    Column {
        Text(label, color = web.text, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(start = 1.dp, bottom = 7.dp))
        Surface(
            modifier = Modifier.fillMaxWidth().height(46.dp),
            shape = RoundedCornerShape(10.dp),
            color = web.surface,
            border = BorderStroke(1.dp, web.borderStrong),
            shadowElevation = 1.dp
        ) {
            BasicTextField(
                value = value,
                onValueChange = onValueChange,
                enabled = enabled,
                singleLine = true,
                visualTransformation = if (password) PasswordVisualTransformation() else androidx.compose.ui.text.input.VisualTransformation.None,
                keyboardOptions = KeyboardOptions(keyboardType = keyboardType, imeAction = imeAction),
                keyboardActions = KeyboardActions(onDone = { onDone() }),
                textStyle = TextStyle(color = web.text, fontSize = 13.sp),
                modifier = Modifier.fillMaxSize().padding(horizontal = 13.dp, vertical = 13.dp)
            )
        }
    }
}

@Composable
private fun LoginSubmit(text: String, enabled: Boolean, onClick: () -> Unit) {
    val web = LocalRPWebColors.current
    Surface(
        onClick = onClick,
        enabled = enabled,
        modifier = Modifier.fillMaxWidth().height(46.dp),
        shape = RoundedCornerShape(10.dp),
        color = web.accent,
        border = BorderStroke(1.dp, web.accent),
        shadowElevation = 7.dp
    ) {
        Box(contentAlignment = Alignment.Center) { Text(text, color = Color.White, fontSize = 12.sp, fontWeight = FontWeight.Bold) }
    }
}

@Composable
private fun Separator(text: String) {
    val web = LocalRPWebColors.current
    Row(modifier = Modifier.fillMaxWidth().padding(vertical = 20.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        HorizontalDivider(modifier = Modifier.weight(1f), color = web.border)
        Text(text, color = web.muted, fontSize = 10.5.sp)
        HorizontalDivider(modifier = Modifier.weight(1f), color = web.border)
    }
}

@Composable
private fun LoginBackdrop(content: @Composable () -> Unit) {
    val web = LocalRPWebColors.current
    BoxWithConstraints(modifier = Modifier.fillMaxSize().background(web.appBackground)) {
        val density = LocalDensity.current
        val widthPx = with(density) { maxWidth.toPx() }
        val heightPx = with(density) { maxHeight.toPx() }
        val maxPx = max(widthPx, heightPx)
        Box(
            modifier = Modifier.fillMaxSize().background(
                Brush.radialGradient(
                    colors = listOf(web.radialOne, Color.Transparent),
                    center = Offset(widthPx * .16f, heightPx * .08f),
                    radius = maxPx * .30f
                )
            )
        )
        Box(
            modifier = Modifier.fillMaxSize().background(
                Brush.radialGradient(
                    colors = listOf(web.radialTwo, Color.Transparent),
                    center = Offset(widthPx * .92f, heightPx * .18f),
                    radius = maxPx * .28f
                )
            )
        )
        Box(modifier = Modifier.fillMaxSize().padding(horizontal = 12.dp, vertical = 28.dp), contentAlignment = Alignment.Center) {
            content()
        }
    }
}

private fun Context.findFragmentActivity(): FragmentActivity? {
    var current: Context? = this
    while (current is ContextWrapper) {
        if (current is FragmentActivity) return current
        current = current.baseContext
    }
    return current as? FragmentActivity
}

private fun avatarModelForLogin(value: String?): String? {
    val raw = value?.trim().orEmpty()
    if (raw.isBlank()) return null
    return when {
        raw.startsWith("http://") || raw.startsWith("https://") -> raw
        raw.startsWith("/") -> BuildConfig.API_ORIGIN + raw
        else -> BuildConfig.API_ORIGIN + "/" + raw
    }
}

private fun initialsForLogin(name: String): String {
    val parts = name.trim().split(Regex("\\s+")).filter { it.isNotBlank() }
    return parts.take(2).joinToString("") { it.first().uppercase() }.ifBlank { "RP" }
}
