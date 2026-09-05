package br.com.rpdoces.admin.ui.appcontrol

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowBack
import androidx.compose.material.icons.outlined.ArrowDownward
import androidx.compose.material.icons.outlined.ArrowUpward
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import br.com.rpdoces.admin.data.auth.AuthUser
import br.com.rpdoces.admin.data.remote.AppConfigHistoryEntry
import br.com.rpdoces.admin.data.remote.AppControlRepository
import br.com.rpdoces.admin.data.remote.AppRemoteConfig
import br.com.rpdoces.admin.data.remote.AppRemoteConfigRepository
import br.com.rpdoces.admin.ui.components.MotionChevron
import br.com.rpdoces.admin.ui.components.MotionDropdownMenu
import br.com.rpdoces.admin.ui.theme.LocalRPWebColors
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlinx.coroutines.launch

private val allowedRoles = setOf("OWNER", "ADMIN")
private val navigationOptions = listOf(
    "dashboard" to "Dashboard",
    "products" to "Produtos",
    "orders" to "Pedidos",
    "admins" to "Administradores",
    "store" to "Loja"
)
private val featureOptions = listOf(
    "dashboard_metrics" to ("Métricas do dashboard" to "Recebido, a receber, comandas e catálogo."),
    "dashboard_flavors" to ("Sabores mais vendidos" to "Ranking dos últimos 30 dias."),
    "dashboard_receivables" to ("Valores a receber" to "Clientes com saldo pendente."),
    "dashboard_recent_orders" to ("Pedidos recentes" to "Últimos pedidos no dashboard."),
    "dashboard_attention" to ("Painel de atenção" to "Alertas operacionais do dashboard."),
    "orders_manual_create" to ("Criar pedido manual" to "Libera o botão Novo pedido."),
    "paid_order_notifications" to ("Notificações de pagamento" to "Permite avisos nativos de pedidos pagos.")
)
private val sectionLabels = mapOf(
    "metrics" to "Métricas",
    "flavors" to "Sabores",
    "receivables" to "Valores a receber",
    "recent_orders" to "Pedidos recentes",
    "attention" to "Atenção"
)

@Composable
fun AppControlScreen(
    viewer: AuthUser,
    onBack: () -> Unit,
    modifier: Modifier = Modifier
) {
    BackHandler(onBack = onBack)
    val web = LocalRPWebColors.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val repository = remember(context) { AppControlRepository(context) }
    val publicRepository = remember(context) { AppRemoteConfigRepository(context) }

    var saved by remember { mutableStateOf<AppRemoteConfig?>(null) }
    var draft by remember { mutableStateOf<AppRemoteConfig?>(null) }
    var history by remember { mutableStateOf<List<AppConfigHistoryEntry>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var status by remember { mutableStateOf<String?>(null) }

    val canManage = viewer.papel.trim().uppercase() in allowedRoles

    suspend fun reload() {
        loading = true
        error = null
        try {
            val payload = repository.load()
            saved = payload.config
            draft = payload.config
            history = payload.history
        } catch (t: Throwable) {
            error = t.message ?: "Não foi possível carregar o controle do app."
        } finally {
            loading = false
        }
    }

    LaunchedEffect(canManage) {
        if (canManage) reload() else loading = false
    }

    fun publish() {
        val current = draft ?: return
        if (saving || current == saved) return
        saving = true
        error = null
        status = null
        scope.launch {
            try {
                val payload = repository.save(current)
                saved = payload.config
                draft = payload.config
                history = payload.history
                status = "Revisão ${payload.config.revision} publicada. O app aplicará a mudança automaticamente."
                runCatching { publicRepository.fetch() }
            } catch (t: Throwable) {
                error = t.message ?: "Não foi possível publicar a configuração."
            } finally {
                saving = false
            }
        }
    }

    fun restore(revision: Int) {
        if (saving) return
        saving = true
        error = null
        status = null
        scope.launch {
            try {
                val payload = repository.restore(revision)
                saved = payload.config
                draft = payload.config
                history = payload.history
                status = "Revisão $revision restaurada como revisão ${payload.config.revision}."
                runCatching { publicRepository.fetch() }
            } catch (t: Throwable) {
                error = t.message ?: "Não foi possível restaurar a revisão."
            } finally {
                saving = false
            }
        }
    }

    Box(modifier = modifier.fillMaxSize().background(web.appBackground)) {
        Column(modifier = Modifier.fillMaxSize()) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                Surface(
                    onClick = onBack,
                    modifier = Modifier.size(38.dp),
                    shape = RoundedCornerShape(11.dp),
                    color = web.surface,
                    border = BorderStroke(1.dp, web.border)
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Icon(Icons.Outlined.ArrowBack, contentDescription = "Voltar", tint = web.muted, modifier = Modifier.size(18.dp))
                    }
                }
                Column(modifier = Modifier.weight(1f)) {
                    Text("Controle do App", color = web.text, fontSize = 21.sp, fontWeight = FontWeight.Bold)
                    Text("Remote config, manutenção, navegação e recursos", color = web.muted, fontSize = 10.5.sp)
                }
            }
            HorizontalDivider(color = web.border)

            when {
                !canManage -> ControlState(
                    title = "Acesso restrito",
                    message = "Somente OWNER e ADMIN podem gerenciar o controle remoto do aplicativo.",
                    danger = true
                )
                loading && draft == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(color = web.accent)
                }
                draft == null -> ControlState(
                    title = "Configuração indisponível",
                    message = error ?: "Não foi possível carregar a configuração.",
                    danger = true,
                    action = { scope.launch { reload() } }
                )
                else -> {
                    val current = draft!!
                    val dirty = saved != current
                    LazyColumn(
                        modifier = Modifier.weight(1f),
                        contentPadding = PaddingValues(start = 14.dp, end = 14.dp, top = 14.dp, bottom = 108.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        item {
                            HeroCard(current)
                        }

                        if (status != null) item {
                            FeedbackCard(status.orEmpty(), success = true)
                        }
                        if (error != null) item {
                            FeedbackCard(error.orEmpty(), success = false)
                        }

                        item {
                            ControlPanel(
                                eyebrow = "SEGURANÇA OPERACIONAL",
                                title = "Modo manutenção",
                                description = "Substitui toda a interface do app por uma tela de indisponibilidade.",
                                trailing = {
                                    ControlToggle(
                                        checked = current.maintenance.enabled,
                                        onChange = { enabled -> draft = current.copy(maintenance = current.maintenance.copy(enabled = enabled)) }
                                    )
                                }
                            ) {
                                ControlTextField("Rótulo", current.maintenance.eyebrow, 32) {
                                    draft = current.copy(maintenance = current.maintenance.copy(eyebrow = it))
                                }
                                ControlTextField("Título", current.maintenance.title, 90) {
                                    draft = current.copy(maintenance = current.maintenance.copy(title = it))
                                }
                                ControlTextField("Mensagem", current.maintenance.message, 320, multiline = true) {
                                    draft = current.copy(maintenance = current.maintenance.copy(message = it))
                                }
                                if (current.maintenance.enabled) {
                                    Text(
                                        "Ao publicar, este mesmo aparelho também entrará em manutenção. Para sair, use o painel web ou publique outra revisão antes do bloqueio ser aplicado.",
                                        color = web.tagOrangeText,
                                        fontSize = 10.sp,
                                        lineHeight = 14.sp,
                                        modifier = Modifier.padding(top = 4.dp)
                                    )
                                }
                            }
                        }

                        item {
                            ControlPanel(
                                eyebrow = "COMPORTAMENTO",
                                title = "Tema e atualização",
                                description = "Preferências globais e versão mínima aceita."
                            ) {
                                ControlSelector(
                                    label = "Tema",
                                    value = current.theme,
                                    options = listOf("system" to "Sistema", "light" to "Claro", "dark" to "Escuro")
                                ) { draft = current.copy(theme = it) }
                                ControlSelector(
                                    label = "Sincronização",
                                    value = current.pollSeconds.toString(),
                                    options = listOf(10L, 15L, 30L, 60L, 120L, 300L).map { it.toString() to pollLabel(it) }
                                ) { draft = current.copy(pollSeconds = it.toLong()) }
                                ControlTextField(
                                    label = "Versão mínima",
                                    value = current.minAppVersionCode.toString(),
                                    maxLength = 7,
                                    numeric = true
                                ) { value ->
                                    draft = current.copy(minAppVersionCode = value.toIntOrNull()?.coerceAtLeast(1) ?: 1)
                                }
                                ControlTextField("URL da atualização", current.update.url, 500) {
                                    draft = current.copy(update = current.update.copy(url = it))
                                }
                                ControlTextField("Título de atualização", current.update.title, 90) {
                                    draft = current.copy(update = current.update.copy(title = it))
                                }
                                ControlTextField("Mensagem de atualização", current.update.message, 320, multiline = true) {
                                    draft = current.copy(update = current.update.copy(message = it))
                                }
                            }
                        }

                        item {
                            ControlPanel(
                                eyebrow = "NAVEGAÇÃO",
                                title = "Abas disponíveis",
                                description = "O app realoca o usuário se a aba atual for ocultada."
                            ) {
                                navigationOptions.forEach { (key, label) ->
                                    SwitchRow(
                                        title = label,
                                        description = if (key == "admins") "Contas e segurança da equipe" else "Visível na navegação principal",
                                        checked = navigationValue(current, key),
                                        onChange = { enabled -> draft = setNavigation(current, key, enabled) }
                                    )
                                }
                            }
                        }

                        item {
                            ControlPanel(
                                eyebrow = "FEATURE FLAGS",
                                title = "Recursos do app",
                                description = "Kill switches e módulos do dashboard."
                            ) {
                                featureOptions.forEach { (key, info) ->
                                    SwitchRow(
                                        title = info.first,
                                        description = info.second,
                                        checked = featureValue(current, key),
                                        onChange = { enabled -> draft = setFeature(current, key, enabled) }
                                    )
                                }
                            }
                        }

                        item {
                            ControlPanel(
                                eyebrow = "DASHBOARD",
                                title = "Banner remoto",
                                description = "Mensagem exibida no topo do dashboard nativo.",
                                trailing = {
                                    ControlToggle(
                                        checked = current.dashboardBanner.enabled,
                                        onChange = { enabled -> draft = current.copy(dashboardBanner = current.dashboardBanner.copy(enabled = enabled)) }
                                    )
                                }
                            ) {
                                ControlTextField("Rótulo", current.dashboardBanner.eyebrow, 30) {
                                    draft = current.copy(dashboardBanner = current.dashboardBanner.copy(eyebrow = it))
                                }
                                ControlTextField("Título", current.dashboardBanner.title, 80) {
                                    draft = current.copy(dashboardBanner = current.dashboardBanner.copy(title = it))
                                }
                                ControlTextField("Mensagem", current.dashboardBanner.message, 280, multiline = true) {
                                    draft = current.copy(dashboardBanner = current.dashboardBanner.copy(message = it))
                                }
                                ControlSelector(
                                    label = "Tom",
                                    value = current.dashboardBanner.tone,
                                    options = listOf(
                                        "accent" to "Destaque",
                                        "success" to "Sucesso",
                                        "warning" to "Aviso",
                                        "neutral" to "Neutro"
                                    )
                                ) { draft = current.copy(dashboardBanner = current.dashboardBanner.copy(tone = it)) }
                            }
                        }

                        item {
                            ControlPanel(
                                eyebrow = "LAYOUT REMOTO",
                                title = "Ordem do dashboard",
                                description = "Reordene blocos sem recompilar o Android."
                            ) {
                                current.dashboardSectionOrder.forEachIndexed { index, section ->
                                    SectionOrderRow(
                                        index = index,
                                        label = sectionLabels[section] ?: section,
                                        canUp = index > 0,
                                        canDown = index < current.dashboardSectionOrder.lastIndex,
                                        onUp = { draft = moveSection(current, index, -1) },
                                        onDown = { draft = moveSection(current, index, 1) }
                                    )
                                }
                            }
                        }

                        item {
                            ControlPanel(
                                eyebrow = "AUDITORIA",
                                title = "Histórico de alterações",
                                description = "Cada publicação cria uma revisão que pode ser restaurada."
                            ) {
                                if (history.isEmpty()) {
                                    Text("Nenhuma revisão encontrada.", color = web.muted, fontSize = 11.sp)
                                } else {
                                    history.take(12).forEach { item ->
                                        HistoryRow(
                                            item = item,
                                            currentRevision = saved?.revision,
                                            saving = saving,
                                            onRestore = { restore(item.revision) }
                                        )
                                    }
                                }
                            }
                        }
                    }

                    Surface(
                        modifier = Modifier.fillMaxWidth(),
                        color = web.surfaceVeilThree,
                        border = BorderStroke(1.dp, web.border)
                    ) {
                        Row(
                            modifier = Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            Column(modifier = Modifier.weight(1f)) {
                                Text(
                                    if (dirty) "Alterações não publicadas" else "Tudo sincronizado",
                                    color = web.text,
                                    fontSize = 11.5.sp,
                                    fontWeight = FontWeight.Bold
                                )
                                Text(
                                    if (dirty) "Revise e publique quando estiver pronto." else "Revisão ${saved?.revision ?: current.revision} ativa.",
                                    color = web.muted,
                                    fontSize = 9.5.sp
                                )
                            }
                            ActionButton(
                                text = "Descartar",
                                enabled = dirty && !saving,
                                primary = false,
                                onClick = { draft = saved; error = null; status = null }
                            )
                            ActionButton(
                                text = if (saving) "Publicando…" else "Publicar",
                                enabled = dirty && !saving,
                                primary = true,
                                onClick = ::publish
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun HeroCard(config: AppRemoteConfig) {
    val web = LocalRPWebColors.current
    val maintenance = config.maintenance.enabled
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(14.dp),
        color = if (maintenance) web.orangeSoft else web.greenSoft,
        border = BorderStroke(1.dp, if (maintenance) web.tagOrangeText.copy(alpha = .4f) else web.tagGreenText.copy(alpha = .35f))
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Box(
                modifier = Modifier.size(9.dp).background(if (maintenance) web.tagOrangeText else web.tagGreenText, CircleShape)
            )
            Column(modifier = Modifier.weight(1f)) {
                Text("CENTRAL DE CONTROLE", color = web.muted, fontSize = 9.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp)
                Text(if (maintenance) "App em manutenção" else "App operacional", color = web.text, fontSize = 16.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 3.dp))
                Text("Revisão ${config.revision}", color = web.muted, fontSize = 10.sp, modifier = Modifier.padding(top = 2.dp))
            }
            Text(if (maintenance) "BLOQUEADO" else "ONLINE", color = if (maintenance) web.tagOrangeText else web.tagGreenText, fontSize = 9.5.sp, fontWeight = FontWeight.Bold)
        }
    }
}

@Composable
private fun ControlPanel(
    eyebrow: String,
    title: String,
    description: String,
    trailing: (@Composable () -> Unit)? = null,
    content: @Composable () -> Unit
) {
    val web = LocalRPWebColors.current
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(14.dp),
        color = web.surfaceVeilTwo,
        border = BorderStroke(1.dp, web.border)
    ) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(eyebrow, color = web.accentDark, fontSize = 8.8.sp, fontWeight = FontWeight.Bold, letterSpacing = .8.sp)
                    Text(title, color = web.text, fontSize = 14.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 3.dp))
                    Text(description, color = web.muted, fontSize = 10.5.sp, lineHeight = 14.sp, modifier = Modifier.padding(top = 3.dp))
                }
                trailing?.invoke()
            }
            HorizontalDivider(color = web.border)
            content()
        }
    }
}

@Composable
private fun ControlTextField(
    label: String,
    value: String,
    maxLength: Int,
    multiline: Boolean = false,
    numeric: Boolean = false,
    onChange: (String) -> Unit
) {
    val web = LocalRPWebColors.current
    Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
        Text(label, color = web.muted, fontSize = 9.8.sp, fontWeight = FontWeight.Bold)
        Surface(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(9.dp),
            color = web.surface,
            border = BorderStroke(1.dp, web.borderStrong)
        ) {
            BasicTextField(
                value = value,
                onValueChange = { raw ->
                    val next = if (numeric) raw.filter(Char::isDigit) else raw
                    if (next.length <= maxLength) onChange(next)
                },
                modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = if (multiline) 10.dp else 9.dp),
                textStyle = TextStyle(color = web.text, fontSize = 11.5.sp, lineHeight = 16.sp),
                minLines = if (multiline) 3 else 1,
                maxLines = if (multiline) 5 else 1,
                keyboardOptions = KeyboardOptions(keyboardType = if (numeric) KeyboardType.Number else KeyboardType.Text)
            )
        }
    }
}

@Composable
private fun ControlSelector(
    label: String,
    value: String,
    options: List<Pair<String, String>>,
    onSelected: (String) -> Unit
) {
    val web = LocalRPWebColors.current
    var open by remember { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
        Text(label, color = web.muted, fontSize = 9.8.sp, fontWeight = FontWeight.Bold)
        Box {
            Surface(
                onClick = { open = true },
                modifier = Modifier.fillMaxWidth().height(40.dp),
                shape = RoundedCornerShape(9.dp),
                color = web.surface,
                border = BorderStroke(1.dp, web.borderStrong)
            ) {
                Row(
                    modifier = Modifier.fillMaxSize().padding(horizontal = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Text(options.firstOrNull { it.first == value }?.second ?: value, color = web.text, fontSize = 11.5.sp, fontWeight = FontWeight.SemiBold)
                    MotionChevron(expanded = open, tint = web.muted, modifier = Modifier.size(17.dp))
                }
            }
            MotionDropdownMenu(expanded = open, onDismissRequest = { open = false }) {
                options.forEach { option ->
                    DropdownMenuItem(
                        text = { Text(option.second, fontSize = 12.sp) },
                        onClick = { onSelected(option.first); open = false }
                    )
                }
            }
        }
    }
}

@Composable
private fun SwitchRow(
    title: String,
    description: String,
    checked: Boolean,
    onChange: (Boolean) -> Unit
) {
    val web = LocalRPWebColors.current
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 3.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(title, color = web.text, fontSize = 11.5.sp, fontWeight = FontWeight.SemiBold)
            Text(description, color = web.muted, fontSize = 9.5.sp, lineHeight = 13.sp, modifier = Modifier.padding(top = 2.dp))
        }
        ControlToggle(checked = checked, onChange = onChange)
    }
}

@Composable
private fun ControlToggle(checked: Boolean, onChange: (Boolean) -> Unit) {
    val web = LocalRPWebColors.current
    Surface(
        onClick = { onChange(!checked) },
        modifier = Modifier.width(42.dp).height(24.dp),
        shape = RoundedCornerShape(99.dp),
        color = if (checked) web.accent else web.graySoft,
        border = BorderStroke(1.dp, if (checked) web.accentDark.copy(alpha = .45f) else web.borderStrong)
    ) {
        Box(modifier = Modifier.fillMaxSize().padding(3.dp)) {
            Box(
                modifier = Modifier.size(16.dp).background(if (checked) Color.White else web.muted.copy(alpha = .45f), CircleShape)
                    .align(if (checked) Alignment.CenterEnd else Alignment.CenterStart)
            )
        }
    }
}

@Composable
private fun SectionOrderRow(
    index: Int,
    label: String,
    canUp: Boolean,
    canDown: Boolean,
    onUp: () -> Unit,
    onDown: () -> Unit
) {
    val web = LocalRPWebColors.current
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        Surface(modifier = Modifier.size(26.dp), shape = CircleShape, color = web.accentSoft) {
            Box(contentAlignment = Alignment.Center) { Text("${index + 1}", color = web.accentDark, fontSize = 10.5.sp, fontWeight = FontWeight.Bold) }
        }
        Text(label, color = web.text, fontSize = 11.5.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
        MiniIconButton(Icons.Outlined.ArrowUpward, "Subir", canUp, onUp)
        MiniIconButton(Icons.Outlined.ArrowDownward, "Descer", canDown, onDown)
    }
}

@Composable
private fun MiniIconButton(icon: androidx.compose.ui.graphics.vector.ImageVector, description: String, enabled: Boolean, onClick: () -> Unit) {
    val web = LocalRPWebColors.current
    Surface(
        onClick = onClick,
        enabled = enabled,
        modifier = Modifier.size(32.dp),
        shape = RoundedCornerShape(8.dp),
        color = web.surface,
        border = BorderStroke(1.dp, web.border)
    ) {
        Box(contentAlignment = Alignment.Center) {
            Icon(icon, contentDescription = description, tint = if (enabled) web.muted else web.muted.copy(alpha = .3f), modifier = Modifier.size(15.dp))
        }
    }
}

@Composable
private fun HistoryRow(
    item: AppConfigHistoryEntry,
    currentRevision: Int?,
    saving: Boolean,
    onRestore: () -> Unit
) {
    val web = LocalRPWebColors.current
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 3.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        Text("#${item.revision}", color = web.accentDark, fontSize = 10.5.sp, fontWeight = FontWeight.Bold, modifier = Modifier.width(40.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(item.updatedByName ?: "Sistema", color = web.text, fontSize = 10.5.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(formatHistoryDate(item.updatedAt), color = web.muted, fontSize = 9.sp)
        }
        ActionButton(
            text = if (item.revision == currentRevision) "Ativa" else "Restaurar",
            enabled = !saving && item.revision != currentRevision,
            primary = false,
            onClick = onRestore
        )
    }
}

@Composable
private fun ActionButton(text: String, enabled: Boolean, primary: Boolean, onClick: () -> Unit) {
    val web = LocalRPWebColors.current
    Surface(
        onClick = onClick,
        enabled = enabled,
        shape = RoundedCornerShape(9.dp),
        color = if (primary) web.accent else web.surface,
        border = BorderStroke(1.dp, if (primary) web.accentDark else web.borderStrong)
    ) {
        Box(modifier = Modifier.height(36.dp).padding(horizontal = 12.dp), contentAlignment = Alignment.Center) {
            Text(text, color = if (primary) Color.White else if (enabled) web.text else web.muted.copy(alpha = .55f), fontSize = 10.5.sp, fontWeight = FontWeight.Bold)
        }
    }
}

@Composable
private fun FeedbackCard(message: String, success: Boolean) {
    val web = LocalRPWebColors.current
    AnimatedVisibility(visible = message.isNotBlank()) {
        Surface(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(10.dp),
            color = if (success) web.greenSoft else web.orangeSoft,
            border = BorderStroke(1.dp, if (success) web.tagGreenText.copy(alpha = .3f) else web.tagOrangeText.copy(alpha = .35f))
        ) {
            Text(message, color = if (success) web.tagGreenText else web.tagOrangeText, fontSize = 10.5.sp, lineHeight = 14.sp, modifier = Modifier.padding(12.dp))
        }
    }
}

@Composable
private fun ControlState(title: String, message: String, danger: Boolean, action: (() -> Unit)? = null) {
    val web = LocalRPWebColors.current
    Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
        Surface(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(14.dp),
            color = web.surface,
            border = BorderStroke(1.dp, web.border)
        ) {
            Column(modifier = Modifier.padding(18.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Text(title, color = if (danger) web.danger else web.text, fontSize = 15.sp, fontWeight = FontWeight.Bold)
                Text(message, color = web.muted, fontSize = 11.sp, lineHeight = 15.sp, modifier = Modifier.padding(top = 5.dp))
                if (action != null) {
                    Spacer(Modifier.height(12.dp))
                    ActionButton("Tentar novamente", enabled = true, primary = true, onClick = action)
                }
            }
        }
    }
}

private fun navigationValue(config: AppRemoteConfig, key: String): Boolean = when (key) {
    "dashboard" -> config.navigation.dashboard
    "products" -> config.navigation.products
    "orders" -> config.navigation.orders
    "admins" -> config.navigation.admins
    "store" -> config.navigation.store
    else -> false
}

private fun setNavigation(config: AppRemoteConfig, key: String, enabled: Boolean): AppRemoteConfig {
    val nav = when (key) {
        "dashboard" -> config.navigation.copy(dashboard = enabled)
        "products" -> config.navigation.copy(products = enabled)
        "orders" -> config.navigation.copy(orders = enabled)
        "admins" -> config.navigation.copy(admins = enabled)
        "store" -> config.navigation.copy(store = enabled)
        else -> config.navigation
    }
    return config.copy(navigation = nav)
}

private fun featureValue(config: AppRemoteConfig, key: String): Boolean = when (key) {
    "dashboard_metrics" -> config.features.dashboardMetrics
    "dashboard_flavors" -> config.features.dashboardFlavors
    "dashboard_receivables" -> config.features.dashboardReceivables
    "dashboard_recent_orders" -> config.features.dashboardRecentOrders
    "dashboard_attention" -> config.features.dashboardAttention
    "orders_manual_create" -> config.features.ordersManualCreate
    "paid_order_notifications" -> config.features.paidOrderNotifications
    else -> false
}

private fun setFeature(config: AppRemoteConfig, key: String, enabled: Boolean): AppRemoteConfig {
    val features = when (key) {
        "dashboard_metrics" -> config.features.copy(dashboardMetrics = enabled)
        "dashboard_flavors" -> config.features.copy(dashboardFlavors = enabled)
        "dashboard_receivables" -> config.features.copy(dashboardReceivables = enabled)
        "dashboard_recent_orders" -> config.features.copy(dashboardRecentOrders = enabled)
        "dashboard_attention" -> config.features.copy(dashboardAttention = enabled)
        "orders_manual_create" -> config.features.copy(ordersManualCreate = enabled)
        "paid_order_notifications" -> config.features.copy(paidOrderNotifications = enabled)
        else -> config.features
    }
    return config.copy(features = features)
}

private fun moveSection(config: AppRemoteConfig, index: Int, direction: Int): AppRemoteConfig {
    val target = index + direction
    if (index !in config.dashboardSectionOrder.indices || target !in config.dashboardSectionOrder.indices) return config
    val next = config.dashboardSectionOrder.toMutableList()
    val temp = next[index]
    next[index] = next[target]
    next[target] = temp
    return config.copy(dashboardSectionOrder = next)
}

private fun pollLabel(seconds: Long): String = when (seconds) {
    10L -> "10 segundos"
    15L -> "15 segundos"
    30L -> "30 segundos"
    60L -> "1 minuto"
    120L -> "2 minutos"
    300L -> "5 minutos"
    else -> "$seconds segundos"
}

private fun formatHistoryDate(value: String?): String {
    if (value.isNullOrBlank()) return "Sistema"
    return runCatching {
        val normalized = if ('T' in value) value else value.replace(' ', 'T') + "Z"
        DateTimeFormatter.ofPattern("dd/MM/yyyy HH:mm", Locale("pt", "BR"))
            .format(Instant.parse(normalized).atZone(ZoneId.systemDefault()))
    }.getOrElse { value }
}
