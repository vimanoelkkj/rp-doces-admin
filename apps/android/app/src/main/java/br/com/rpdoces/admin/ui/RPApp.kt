package br.com.rpdoces.admin.ui

import android.Manifest
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.animation.core.animateColorAsState
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
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
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import br.com.rpdoces.admin.BuildConfig
import br.com.rpdoces.admin.data.admins.AdminsRepository
import br.com.rpdoces.admin.data.auth.AuthRepository
import br.com.rpdoces.admin.data.auth.AuthUser
import br.com.rpdoces.admin.data.dashboard.DashboardRepository
import br.com.rpdoces.admin.data.orders.Order
import br.com.rpdoces.admin.data.orders.OrdersRepository
import br.com.rpdoces.admin.data.products.ProductsRepository
import br.com.rpdoces.admin.data.store.StoreRepository
import br.com.rpdoces.admin.notifications.NativeNotifications
import br.com.rpdoces.admin.ui.admins.AdminsScreen
import br.com.rpdoces.admin.ui.auth.AuthUiState
import br.com.rpdoces.admin.ui.auth.AuthViewModel
import br.com.rpdoces.admin.ui.components.MotionDropdownMenu
import br.com.rpdoces.admin.ui.components.MotionValue
import br.com.rpdoces.admin.ui.components.RPMotion
import br.com.rpdoces.admin.ui.dashboard.DashboardScreen
import br.com.rpdoces.admin.ui.orders.OrdersScreen
import br.com.rpdoces.admin.ui.products.ProductsScreen
import br.com.rpdoces.admin.ui.remote.LocalAppRemoteConfig
import br.com.rpdoces.admin.ui.store.StoreScreen
import br.com.rpdoces.admin.ui.theme.LocalRPThemeController
import br.com.rpdoces.admin.ui.theme.LocalRPWebColors
import br.com.rpdoces.admin.ui.theme.RPWebMetrics
import coil3.compose.AsyncImage
import kotlin.math.max
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive

private enum class MainTab(
    val remoteKey: String,
    val label: String,
    val mobileLabel: String,
    val subtitle: String,
    val icon: ImageVector
) {
    Dashboard("dashboard", "Dashboard", "Dashboard", "Visão geral da operação", SiteNavIcons.Dashboard),
    Produtos("products", "Produtos", "Produtos", "Catálogo, categorias, estoque e promoções", SiteNavIcons.Products),
    Pedidos("orders", "Pedidos", "Pedidos", "", SiteNavIcons.Orders),
    Admins("admins", "Administradores", "Admins", "Contas, níveis de acesso e segurança da equipe", SiteNavIcons.Users),
    Loja("store", "Loja", "Loja", "Atendimento, contato e aparência do site público", SiteNavIcons.Store)
}

@Composable
fun RPApp(
    authRepository: AuthRepository,
    dashboardRepository: DashboardRepository,
    productsRepository: ProductsRepository,
    ordersRepository: OrdersRepository,
    adminsRepository: AdminsRepository,
    storeRepository: StoreRepository
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
            productsRepository = productsRepository,
            ordersRepository = ordersRepository,
            adminsRepository = adminsRepository,
            storeRepository = storeRepository,
            onLogout = authViewModel::logout
        )
    }
}

@Composable
private fun LoadingScreen() {
    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
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

    Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Box(
            modifier = Modifier.fillMaxSize().padding(horizontal = 24.dp),
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
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Text, imeAction = ImeAction.Next)
                    )
                    OutlinedTextField(
                        value = password,
                        onValueChange = { password = it },
                        modifier = Modifier.fillMaxWidth(),
                        enabled = !submitting,
                        singleLine = true,
                        label = { Text("Senha") },
                        visualTransformation = PasswordVisualTransformation(),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
                        keyboardActions = KeyboardActions(
                            onDone = {
                                focusManager.clearFocus()
                                if (!submitting) onLogin(username, password)
                            }
                        )
                    )
                    if (error != null) {
                        Text(text = error, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
                    }
                    Button(
                        onClick = {
                            focusManager.clearFocus()
                            onLogin(username, password)
                        },
                        modifier = Modifier.fillMaxWidth().height(52.dp),
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
    productsRepository: ProductsRepository,
    ordersRepository: OrdersRepository,
    adminsRepository: AdminsRepository,
    storeRepository: StoreRepository,
    onLogout: () -> Unit
) {
    val context = LocalContext.current
    val remoteConfig = LocalAppRemoteConfig.current
    val visibleTabs = remember(remoteConfig.navigation) {
        MainTab.entries.filter { remoteConfig.navigation.isVisible(it.remoteKey) }
    }
    var selected by rememberSaveable { mutableStateOf(MainTab.Dashboard) }
    var profileOpen by rememberSaveable { mutableStateOf(false) }
    var notificationOpen by rememberSaveable { mutableStateOf(false) }
    var notificationsEnabled by remember { mutableStateOf(NativeNotifications.isEnabled(context)) }

    fun openTab(tab: MainTab) {
        if (tab !in visibleTabs || tab == selected) return
        profileOpen = false
        notificationOpen = false
        selected = tab
    }

    LaunchedEffect(visibleTabs, selected) {
        if (selected !in visibleTabs) {
            selected = visibleTabs.firstOrNull() ?: MainTab.Dashboard
            profileOpen = false
            notificationOpen = false
        }
    }

    val permissionLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        NativeNotifications.setEnabled(context, granted)
        notificationsEnabled = NativeNotifications.isEnabled(context)
    }

    fun toggleNotifications() {
        if (!remoteConfig.features.paidOrderNotifications) return
        if (notificationsEnabled) {
            NativeNotifications.setEnabled(context, false)
            notificationsEnabled = false
            return
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && !NativeNotifications.hasPermission(context)) {
            permissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        } else {
            NativeNotifications.setEnabled(context, true)
            notificationsEnabled = NativeNotifications.isEnabled(context)
        }
    }

    LaunchedEffect(Unit) {
        NativeNotifications.createChannel(context)
    }

    LaunchedEffect(notificationsEnabled, user.id, remoteConfig.features.paidOrderNotifications) {
        if (!notificationsEnabled || !remoteConfig.features.paidOrderNotifications) return@LaunchedEffect
        var knownPaidIds = emptySet<Int>()
        var seeded = false

        while (isActive) {
            val latest = runCatching { ordersRepository.list() }.getOrNull()
            if (latest != null) {
                val paid = latest.filter(::orderIsPaid)
                val paidIds = paid.map { it.id }.toSet()
                if (seeded) {
                    paid.filter { it.id !in knownPaidIds }.forEach { order ->
                        NativeNotifications.showPaidOrder(context, order)
                    }
                } else {
                    seeded = true
                }
                knownPaidIds = paidIds
            }
            delay(15_000)
        }
    }

    AppBackground {
        Scaffold(
            containerColor = Color.Transparent,
            bottomBar = {
                MobileBottomBar(
                    selected = selected,
                    tabs = visibleTabs,
                    onSelected = ::openTab
                )
            }
        ) { scaffoldPadding ->
            Box(modifier = Modifier.fillMaxSize()) {
                AnimatedContent(
                    targetState = selected,
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(bottom = scaffoldPadding.calculateBottomPadding())
                        .padding(top = RPWebMetrics.mobileContentTop),
                    transitionSpec = {
                        val direction = if (targetState.ordinal >= initialState.ordinal) 1 else -1
                        (fadeIn(tween(RPMotion.Fast, easing = RPMotion.EaseOut)) +
                            slideInHorizontally(tween(RPMotion.Normal, easing = RPMotion.EaseOut)) { direction * it / 7 }) togetherWith
                            (fadeOut(tween(RPMotion.Fast)) +
                                slideOutHorizontally(tween(RPMotion.Fast)) { -direction * it / 9 })
                    },
                    label = "main-tab"
                ) { tab ->
                    Column(modifier = Modifier.fillMaxSize()) {
                        PageHeader(tab)
                        when (tab) {
                            MainTab.Dashboard -> DashboardScreen(
                                repository = dashboardRepository,
                                onOpenOrders = { openTab(MainTab.Pedidos) },
                                modifier = Modifier.fillMaxSize()
                            )
                            MainTab.Produtos -> ProductsScreen(
                                repository = productsRepository,
                                modifier = Modifier.fillMaxSize()
                            )
                            MainTab.Pedidos -> OrdersScreen(
                                repository = ordersRepository,
                                modifier = Modifier.fillMaxSize()
                            )
                            MainTab.Admins -> AdminsScreen(
                                repository = adminsRepository,
                                viewer = user,
                                modifier = Modifier.fillMaxSize()
                            )
                            MainTab.Loja -> StoreScreen(
                                repository = storeRepository,
                                modifier = Modifier.fillMaxSize()
                            )
                        }
                    }
                }

                MobileUtilities(
                    user = user,
                    profileOpen = profileOpen,
                    notificationOpen = notificationOpen,
                    notificationsEnabled = notificationsEnabled && remoteConfig.features.paidOrderNotifications,
                    notificationFeatureEnabled = remoteConfig.features.paidOrderNotifications,
                    onProfileOpenChange = {
                        notificationOpen = false
                        profileOpen = it
                    },
                    onNotificationOpenChange = {
                        profileOpen = false
                        notificationOpen = it
                        if (it) notificationsEnabled = NativeNotifications.isEnabled(context)
                    },
                    onToggleNotifications = ::toggleNotifications,
                    onLogout = onLogout,
                    modifier = Modifier
                        .align(Alignment.TopEnd)
                        .windowInsetsPadding(WindowInsets.statusBars)
                        .padding(end = RPWebMetrics.utilityRight)
                )
            }
        }
    }
}

@Composable
private fun PageHeader(tab: MainTab) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(
                start = RPWebMetrics.mobileWorkspacePadding + RPWebMetrics.mobileHeaderHorizontalMargin,
                end = RPWebMetrics.mobileWorkspacePadding + RPWebMetrics.mobileHeaderHorizontalMargin,
                bottom = RPWebMetrics.mobileHeaderBottomMargin
            ),
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
        if (tab.subtitle.isNotBlank()) {
            Text(
                text = tab.subtitle,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                fontSize = 11.5.sp,
                lineHeight = 16.sp
            )
        }
    }
}

@Composable
private fun AppBackground(content: @Composable () -> Unit) {
    val web = LocalRPWebColors.current
    BoxWithConstraints(
        modifier = Modifier.fillMaxSize().background(web.appBackground)
    ) {
        val density = LocalDensity.current
        val widthPx = with(density) { maxWidth.toPx() }
        val heightPx = with(density) { maxHeight.toPx() }
        val maxPx = max(widthPx, heightPx)

        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(
                    Brush.radialGradient(
                        colors = listOf(web.radialOne, Color.Transparent),
                        center = Offset(widthPx * .16f, heightPx * .08f),
                        radius = maxPx * .28f
                    )
                )
        )
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(
                    Brush.radialGradient(
                        colors = listOf(web.radialTwo, Color.Transparent),
                        center = Offset(widthPx * .94f, heightPx * .14f),
                        radius = maxPx * .25f
                    )
                )
        )
        content()

        val dark = web.appBackground == br.com.rpdoces.admin.ui.theme.RPWebDarkColors.appBackground
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .windowInsetsTopHeight(WindowInsets.statusBars)
                .background(if (dark) web.appBackground else web.accent)
                .align(Alignment.TopCenter)
        )
    }
}

@Composable
private fun MobileUtilities(
    user: AuthUser,
    profileOpen: Boolean,
    notificationOpen: Boolean,
    notificationsEnabled: Boolean,
    notificationFeatureEnabled: Boolean,
    onProfileOpenChange: (Boolean) -> Unit,
    onNotificationOpenChange: (Boolean) -> Unit,
    onToggleNotifications: () -> Unit,
    onLogout: () -> Unit,
    modifier: Modifier = Modifier
) {
    val web = LocalRPWebColors.current
    val theme = LocalRPThemeController.current
    val profileScale by animateFloatAsState(
        targetValue = if (profileOpen) .94f else 1f,
        animationSpec = tween(RPMotion.Fast, easing = RPMotion.EaseOut),
        label = "profile-scale"
    )
    val notificationScale by animateFloatAsState(
        targetValue = if (notificationOpen) .94f else 1f,
        animationSpec = tween(RPMotion.Fast, easing = RPMotion.EaseOut),
        label = "notification-scale"
    )

    Row(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(RPWebMetrics.utilityGap),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box {
            Surface(
                onClick = { onNotificationOpenChange(!notificationOpen) },
                modifier = Modifier
                    .size(RPWebMetrics.utilitySize)
                    .graphicsLayer {
                        scaleX = notificationScale
                        scaleY = notificationScale
                    },
                shape = RoundedCornerShape(RPWebMetrics.utilityRadius),
                color = web.surface,
                border = BorderStroke(1.dp, web.border)
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(
                        imageVector = SiteNavIcons.Bell,
                        contentDescription = "Notificações",
                        tint = web.muted,
                        modifier = Modifier.size(18.dp)
                    )
                }
            }

            if (notificationsEnabled) {
                Box(
                    modifier = Modifier
                        .padding(top = 6.dp, end = 6.dp)
                        .size(7.dp)
                        .background(web.accent, RoundedCornerShape(99.dp))
                        .align(Alignment.TopEnd)
                )
            }

            MotionDropdownMenu(
                expanded = notificationOpen,
                onDismissRequest = { onNotificationOpenChange(false) }
            ) {
                Column(modifier = Modifier.width(286.dp).padding(horizontal = 16.dp, vertical = 14.dp)) {
                    Text("Notificações", color = web.text, fontSize = 13.5.sp, fontWeight = FontWeight.Bold)
                    Text(
                        if (notificationFeatureEnabled) "Receba um aviso quando um novo pedido for pago." else "As notificações foram pausadas remotamente.",
                        color = web.muted,
                        fontSize = 10.5.sp,
                        lineHeight = 15.sp,
                        modifier = Modifier.padding(top = 4.dp)
                    )
                    Surface(
                        modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
                        shape = RoundedCornerShape(10.dp),
                        color = if (notificationsEnabled) web.greenSoft else web.graySoft
                    ) {
                        Column(modifier = Modifier.padding(12.dp)) {
                            MotionValue(targetState = notificationsEnabled) { enabled ->
                                Text(
                                    if (enabled) "Ativas neste aparelho" else if (notificationFeatureEnabled) "Desativadas neste aparelho" else "Pausadas pelo servidor",
                                    color = if (enabled) web.tagGreenText else web.muted,
                                    fontSize = 10.5.sp,
                                    fontWeight = FontWeight.Bold
                                )
                            }
                            Text(
                                if (notificationsEnabled) "Você receberá avisos de novos pedidos pagos." else if (notificationFeatureEnabled) "Ative para permitir avisos nativos do Android." else "O recurso volta automaticamente quando for reativado.",
                                color = web.muted,
                                fontSize = 10.sp,
                                lineHeight = 14.sp,
                                modifier = Modifier.padding(top = 3.dp)
                            )
                        }
                    }
                    if (notificationFeatureEnabled) {
                        Surface(
                            onClick = onToggleNotifications,
                            modifier = Modifier.fillMaxWidth().padding(top = 10.dp),
                            shape = RoundedCornerShape(9.dp),
                            color = web.surface,
                            border = BorderStroke(1.dp, web.borderStrong)
                        ) {
                            Box(modifier = Modifier.height(38.dp), contentAlignment = Alignment.Center) {
                                Text(
                                    if (notificationsEnabled) "Desativar notificações" else "Ativar notificações",
                                    color = web.accentDark,
                                    fontSize = 10.5.sp,
                                    fontWeight = FontWeight.Bold
                                )
                            }
                        }
                    }
                }
            }
        }

        Box {
            Surface(
                onClick = { onProfileOpenChange(!profileOpen) },
                modifier = Modifier
                    .size(RPWebMetrics.utilitySize)
                    .graphicsLayer {
                        scaleX = profileScale
                        scaleY = profileScale
                    },
                shape = RoundedCornerShape(RPWebMetrics.utilityRadius),
                color = web.surface,
                border = BorderStroke(1.dp, web.border)
            ) {
                Box(contentAlignment = Alignment.Center) {
                    val avatar = avatarModel(user.avatarUrl)
                    if (avatar != null) {
                        AsyncImage(
                            model = avatar,
                            contentDescription = user.nome,
                            modifier = Modifier.size(RPWebMetrics.avatarSize),
                            contentScale = ContentScale.Crop
                        )
                    } else {
                        Surface(
                            modifier = Modifier.size(RPWebMetrics.avatarSize),
                            shape = RoundedCornerShape(16.dp),
                            color = web.accentSoft
                        ) {
                            Box(contentAlignment = Alignment.Center) {
                                Text(
                                    text = userInitials(user.nome),
                                    color = web.accentDark,
                                    fontSize = 10.5.sp,
                                    fontWeight = FontWeight.Bold
                                )
                            }
                        }
                    }
                }
            }

            MotionDropdownMenu(expanded = profileOpen, onDismissRequest = { onProfileOpenChange(false) }) {
                Column(modifier = Modifier.width(245.dp).padding(horizontal = 14.dp, vertical = 12.dp)) {
                    Text(user.nome, color = web.text, fontSize = 12.5.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(
                        "@${user.username} · ${user.papel}",
                        color = web.muted,
                        fontSize = 10.sp,
                        modifier = Modifier.padding(top = 2.dp),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                    if (!user.email.isNullOrBlank()) {
                        Text(user.email, color = web.muted, fontSize = 9.5.sp, modifier = Modifier.padding(top = 2.dp), maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    HorizontalDivider(color = web.border, modifier = Modifier.padding(vertical = 10.dp))
                    Surface(
                        onClick = {
                            onProfileOpenChange(false)
                            theme.toggle()
                        },
                        modifier = Modifier.fillMaxWidth(),
                        color = Color.Transparent
                    ) {
                        Row(
                            modifier = Modifier.padding(horizontal = 4.dp, vertical = 8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(9.dp)
                        ) {
                            Icon(
                                imageVector = if (theme.isDark) SiteNavIcons.Sun else SiteNavIcons.Moon,
                                contentDescription = null,
                                tint = web.muted,
                                modifier = Modifier.size(17.dp)
                            )
                            Text(
                                if (theme.isDark) "Usar tema claro" else "Usar tema escuro",
                                color = web.text,
                                fontSize = 10.5.sp,
                                fontWeight = FontWeight.SemiBold
                            )
                        }
                    }
                    Surface(
                        onClick = {
                            onProfileOpenChange(false)
                            onLogout()
                        },
                        modifier = Modifier.fillMaxWidth(),
                        color = Color.Transparent
                    ) {
                        Row(
                            modifier = Modifier.padding(horizontal = 4.dp, vertical = 8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(9.dp)
                        ) {
                            Icon(SiteNavIcons.Logout, contentDescription = null, tint = web.danger, modifier = Modifier.size(17.dp))
                            Text("Sair da conta", color = web.danger, fontSize = 10.5.sp, fontWeight = FontWeight.SemiBold)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun MobileBottomBar(
    selected: MainTab,
    tabs: List<MainTab>,
    onSelected: (MainTab) -> Unit
) {
    val web = LocalRPWebColors.current
    Surface(color = web.surface, shadowElevation = 0.dp) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .windowInsetsPadding(WindowInsets.navigationBars)
                .padding(top = RPWebMetrics.bottomBarOuterPadding, bottom = RPWebMetrics.bottomBarOuterPadding)
        ) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(1.dp)
                    .background(web.border)
            )
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(RPWebMetrics.bottomNavItemHeight)
                    .padding(horizontal = 5.dp)
            ) {
                tabs.forEach { tab ->
                    val active = selected == tab
                    val indicatorWidth by animateDpAsState(
                        targetValue = if (active) RPWebMetrics.bottomNavIndicatorWidth else 0.dp,
                        animationSpec = tween(RPMotion.Normal, easing = RPMotion.EaseOut),
                        label = "nav-indicator-${tab.name}"
                    )
                    val iconScale by animateFloatAsState(
                        targetValue = if (active) 1f else .92f,
                        animationSpec = tween(RPMotion.Normal, easing = RPMotion.EaseOut),
                        label = "nav-icon-${tab.name}"
                    )
                    val iconTint by animateColorAsState(
                        targetValue = if (active) web.accentDark else web.muted,
                        animationSpec = tween(RPMotion.Fast),
                        label = "nav-tint-${tab.name}"
                    )
                    val labelColor by animateColorAsState(
                        targetValue = if (active) web.accentDark else web.muted,
                        animationSpec = tween(RPMotion.Fast),
                        label = "nav-label-${tab.name}"
                    )
                    Box(
                        modifier = Modifier
                            .weight(1f)
                            .fillMaxSize()
                            .clickable { onSelected(tab) }
                            .padding(horizontal = 2.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        Box(
                            modifier = Modifier
                                .align(Alignment.TopCenter)
                                .width(indicatorWidth)
                                .height(RPWebMetrics.bottomNavIndicatorHeight)
                                .background(web.accent, RoundedCornerShape(99.dp))
                        )
                        Column(
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.spacedBy(2.dp)
                        ) {
                            Box(modifier = Modifier.size(RPWebMetrics.bottomNavIconBox), contentAlignment = Alignment.Center) {
                                Icon(
                                    imageVector = tab.icon,
                                    contentDescription = tab.label,
                                    modifier = Modifier
                                        .size(RPWebMetrics.bottomNavIcon)
                                        .graphicsLayer {
                                            scaleX = iconScale
                                            scaleY = iconScale
                                        },
                                    tint = iconTint
                                )
                            }
                            Text(
                                text = tab.mobileLabel,
                                color = labelColor,
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

private fun orderIsPaid(order: Order): Boolean =
    order.financialStatus.equals("PAGO", ignoreCase = true) ||
        order.paymentStatus.equals("PAGO", ignoreCase = true)

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
