package br.com.rpdoces.admin.ui.admins

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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
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
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import br.com.rpdoces.admin.BuildConfig
import br.com.rpdoces.admin.data.admins.AdminUser
import br.com.rpdoces.admin.data.admins.AdminsRepository
import br.com.rpdoces.admin.data.admins.CreateAdminInput
import br.com.rpdoces.admin.data.auth.AuthUser
import br.com.rpdoces.admin.ui.components.WebField
import br.com.rpdoces.admin.ui.components.WebModal
import br.com.rpdoces.admin.ui.components.WebModalActions
import br.com.rpdoces.admin.ui.components.WebModalHeader
import br.com.rpdoces.admin.ui.theme.LocalRPWebColors
import coil3.compose.AsyncImage
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlinx.coroutines.launch

private sealed interface AdminConfirmation {
    data class Role(val user: AdminUser, val nextRole: String) : AdminConfirmation
    data class Active(val user: AdminUser, val nextActive: Boolean) : AdminConfirmation
}

@Composable
fun AdminsScreen(
    repository: AdminsRepository,
    viewer: AuthUser,
    modifier: Modifier = Modifier
) {
    val web = LocalRPWebColors.current
    val scope = rememberCoroutineScope()
    val isOwner = viewer.papel == "OWNER"
    var users by remember { mutableStateOf<List<AdminUser>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var feedback by remember { mutableStateOf<String?>(null) }
    var createOpen by remember { mutableStateOf(false) }
    var passwordUser by remember { mutableStateOf<AdminUser?>(null) }
    var confirmation by remember { mutableStateOf<AdminConfirmation?>(null) }
    var busyId by remember { mutableStateOf<Int?>(null) }

    suspend fun reload() {
        try {
            users = repository.list()
            error = null
        } catch (t: Throwable) {
            error = t.message ?: "Não foi possível carregar os administradores."
        } finally {
            loading = false
        }
    }

    LaunchedEffect(Unit) { reload() }

    val visibleUsers = if (isOwner) users else users.filter { it.id == viewer.id }
    val activeCount = users.count { it.ativo }
    val ownerCount = users.count { it.ativo && it.papel == "OWNER" }

    LazyColumn(
        modifier = modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = 12.dp, end = 12.dp, bottom = 28.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        item {
            Column {
                Text("CONTROLE DE ACESSO", color = web.accentDark, fontSize = 9.5.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = .5.sp)
                Text(if (isOwner) "Equipe administrativa" else "Sua conta", color = web.text, fontSize = 18.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 4.dp))
                Text(
                    if (isOwner) "Gerencie quem pode acessar e operar o painel da R&P Doces." else "Confira os dados do seu acesso e altere sua senha quando precisar.",
                    color = web.muted,
                    fontSize = 11.5.sp,
                    lineHeight = 16.sp,
                    modifier = Modifier.padding(top = 4.dp)
                )
            }
        }

        if (isOwner) {
            item {
                Surface(onClick = { createOpen = true }, color = Color.Transparent) {
                    Text("+ Novo administrador", color = web.accentDark, fontSize = 12.5.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(vertical = 9.dp, horizontal = 2.dp))
                }
            }
            item {
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    AccessSummary("Contas", users.size.toString(), Modifier.weight(1f))
                    AccessSummary("Ativas", activeCount.toString(), Modifier.weight(1f))
                    AccessSummary("Mestres ativos", ownerCount.toString(), Modifier.weight(1f))
                }
            }
        }

        if (feedback != null) {
            item {
                Surface(shape = RoundedCornerShape(10.dp), color = web.greenSoft, modifier = Modifier.fillMaxWidth()) {
                    Text(feedback.orEmpty(), color = web.tagGreenText, fontSize = 11.5.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(12.dp))
                }
            }
        }

        if (error != null) {
            item {
                Surface(shape = RoundedCornerShape(10.dp), color = web.accentSoft, modifier = Modifier.fillMaxWidth()) {
                    Row(modifier = Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(error.orEmpty(), color = web.danger, fontSize = 11.5.sp, modifier = Modifier.weight(1f))
                        Surface(onClick = { scope.launch { reload() } }, color = Color.Transparent) {
                            Text("Tentar novamente", color = web.danger, fontSize = 10.5.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(6.dp))
                        }
                    }
                }
            }
        }

        if (loading && users.isEmpty()) {
            item {
                Box(modifier = Modifier.fillMaxWidth().height(180.dp), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(color = web.accent)
                }
            }
        } else {
            items(visibleUsers, key = { it.id }) { user ->
                AdminCard(
                    user = user,
                    isViewer = user.id == viewer.id,
                    isOwnerViewer = isOwner,
                    busy = busyId == user.id,
                    onPassword = { passwordUser = user },
                    onToggleRole = { confirmation = AdminConfirmation.Role(user, if (user.papel == "OWNER") "ADMIN" else "OWNER") },
                    onToggleActive = { confirmation = AdminConfirmation.Active(user, !user.ativo) }
                )
            }
        }
    }

    if (createOpen) {
        CreateAdminModal(
            onDismiss = { createOpen = false },
            onCreate = { input, done ->
                scope.launch {
                    runCatching { repository.create(input) }
                        .onSuccess {
                            feedback = "Administrador criado com sucesso."
                            createOpen = false
                            reload()
                        }
                        .onFailure { error = it.message ?: "Não foi possível criar o administrador." }
                    done()
                }
            }
        )
    }

    passwordUser?.let { user ->
        PasswordModal(
            user = user,
            onDismiss = { passwordUser = null },
            onSave = { password, done ->
                scope.launch {
                    runCatching { repository.resetPassword(user.id, password) }
                        .onSuccess {
                            feedback = "Senha de ${user.nome} atualizada."
                            passwordUser = null
                        }
                        .onFailure { error = it.message ?: "Não foi possível alterar a senha." }
                    done()
                }
            }
        )
    }

    confirmation?.let { action ->
        val user = when (action) {
            is AdminConfirmation.Role -> action.user
            is AdminConfirmation.Active -> action.user
        }
        val title: String
        val message: String
        val actionLabel: String
        val danger: Boolean
        when (action) {
            is AdminConfirmation.Role -> {
                val toOwner = action.nextRole == "OWNER"
                title = if (toOwner) "Tornar ${user.nome} mestre?" else "Tornar ${user.nome} administrador?"
                message = if (toOwner) "A conta passará a criar e gerenciar outros administradores." else "A conta deixará de gerenciar outros administradores."
                actionLabel = if (toOwner) "Tornar mestre" else "Tornar administrador"
                danger = false
            }
            is AdminConfirmation.Active -> {
                title = if (action.nextActive) "Reativar ${user.nome}?" else "Desativar ${user.nome}?"
                message = if (action.nextActive) "A conta poderá voltar a acessar o painel normalmente." else "O acesso será bloqueado imediatamente e as sessões dessa conta serão encerradas."
                actionLabel = if (action.nextActive) "Reativar conta" else "Desativar conta"
                danger = !action.nextActive
            }
        }

        ConfirmationModal(
            title = title,
            message = message,
            actionLabel = actionLabel,
            danger = danger,
            busy = busyId == user.id,
            onDismiss = { if (busyId == null) confirmation = null },
            onConfirm = {
                if (busyId != null) return@ConfirmationModal
                busyId = user.id
                feedback = null
                scope.launch {
                    runCatching {
                        when (action) {
                            is AdminConfirmation.Role -> repository.setRole(user.id, action.nextRole)
                            is AdminConfirmation.Active -> repository.setActive(user.id, action.nextActive)
                        }
                    }.onSuccess {
                        feedback = when (action) {
                            is AdminConfirmation.Role -> "Nível de acesso de ${user.nome} atualizado."
                            is AdminConfirmation.Active -> if (action.nextActive) "${user.nome} foi reativado." else "${user.nome} foi desativado."
                        }
                    }.onFailure { error = it.message ?: "Não foi possível alterar a conta." }
                    reload()
                    busyId = null
                    confirmation = null
                }
            }
        )
    }
}

@Composable
private fun AccessSummary(label: String, value: String, modifier: Modifier = Modifier) {
    val web = LocalRPWebColors.current
    Surface(modifier = modifier, shape = RoundedCornerShape(12.dp), color = web.surface, border = BorderStroke(1.dp, web.border)) {
        Column(modifier = Modifier.padding(horizontal = 12.dp, vertical = 12.dp)) {
            Text(label.uppercase(), color = web.muted, fontSize = 9.5.sp, fontWeight = FontWeight.Bold, letterSpacing = .35.sp)
            Text(value, color = web.text, fontSize = 18.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 4.dp))
        }
    }
}

@Composable
private fun AdminCard(
    user: AdminUser,
    isViewer: Boolean,
    isOwnerViewer: Boolean,
    busy: Boolean,
    onPassword: () -> Unit,
    onToggleRole: () -> Unit,
    onToggleActive: () -> Unit
) {
    val web = LocalRPWebColors.current
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(14.dp),
        color = web.surface,
        border = BorderStroke(1.dp, web.border)
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Surface(modifier = Modifier.size(42.dp), shape = RoundedCornerShape(50), color = web.accent) {
                    Box(contentAlignment = Alignment.Center) {
                        val avatar = user.avatarUrl?.let { if (it.startsWith("http")) it else BuildConfig.API_ORIGIN + it }
                        if (!avatar.isNullOrBlank()) {
                            AsyncImage(model = avatar, contentDescription = user.nome, modifier = Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
                        } else {
                            Text(initials(user.nome), color = Color.White, fontSize = 14.sp, fontWeight = FontWeight.Bold)
                        }
                    }
                }
                Column(modifier = Modifier.weight(1f)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(user.nome, color = web.text, fontSize = 14.5.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        if (isViewer) {
                            Surface(shape = RoundedCornerShape(5.dp), color = web.accentSoft) {
                                Text("Você", color = web.accentDark, fontSize = 9.5.sp, fontWeight = FontWeight.ExtraBold, modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp))
                            }
                        }
                    }
                    Text("@${user.username}", color = web.muted, fontSize = 11.5.sp, modifier = Modifier.padding(top = 2.dp))
                }
                Surface(shape = RoundedCornerShape(8.dp), color = if (user.ativo) web.greenSoft else web.graySoft) {
                    Text(if (user.ativo) "Ativo" else "Inativo", color = if (user.ativo) web.tagGreenText else web.muted, fontSize = 10.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(horizontal = 9.dp, vertical = 5.dp))
                }
            }

            Row(modifier = Modifier.fillMaxWidth().padding(vertical = 14.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                MetaCell("E-mail", user.email ?: "—", Modifier.weight(1.3f))
                MetaCell("Nível", if (user.papel == "OWNER") "Mestre" else "Administrador", Modifier.weight(1f))
                MetaCell("Desde", dateLabel(user.createdAt), Modifier.weight(.8f))
            }
            HorizontalDivider(color = web.border)

            Row(modifier = Modifier.fillMaxWidth().padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(18.dp)) {
                if (isOwnerViewer || isViewer) AdminAction("Alterar senha", false, !busy, onPassword)
                if (isOwnerViewer && !isViewer) {
                    AdminAction(if (user.papel == "OWNER") "Tornar administrador" else "Tornar mestre", false, !busy, onToggleRole)
                    AdminAction(if (user.ativo) "Desativar" else "Reativar", user.ativo, !busy, onToggleActive)
                }
            }
        }
    }
}

@Composable
private fun MetaCell(label: String, value: String, modifier: Modifier = Modifier) {
    val web = LocalRPWebColors.current
    Column(modifier = modifier) {
        Text(label, color = web.muted, fontSize = 10.sp)
        Text(value, color = web.text, fontSize = 11.5.sp, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 3.dp))
    }
}

@Composable
private fun AdminAction(text: String, danger: Boolean, enabled: Boolean, onClick: () -> Unit) {
    val web = LocalRPWebColors.current
    Surface(onClick = onClick, enabled = enabled, color = Color.Transparent) {
        Text(text, color = if (danger) web.danger else web.muted, fontSize = 11.5.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(horizontal = 2.dp, vertical = 7.dp))
    }
}

@Composable
private fun CreateAdminModal(
    onDismiss: () -> Unit,
    onCreate: (CreateAdminInput, () -> Unit) -> Unit
) {
    val web = LocalRPWebColors.current
    var name by remember { mutableStateOf("") }
    var username by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var confirm by remember { mutableStateOf("") }
    var role by remember { mutableStateOf("ADMIN") }
    var localError by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }

    WebModal(onDismiss = { if (!busy) onDismiss() }) {
        WebModalHeader("Novo acesso", "Criar administrador", null, onClose = { if (!busy) onDismiss() })
        WebField("Nome", name, { name = it.take(100) })
        Spacer(Modifier.height(12.dp))
        WebField("Usuário", username, { username = it.lowercase().take(30) }, placeholder = "ex.: maria")
        Spacer(Modifier.height(12.dp))
        WebField("E-mail", email, { email = it.lowercase().take(254) })
        Spacer(Modifier.height(12.dp))
        WebField("Senha inicial", password, { password = it }, visualTransformation = PasswordVisualTransformation())
        Spacer(Modifier.height(12.dp))
        WebField("Confirmar senha", confirm, { confirm = it }, visualTransformation = PasswordVisualTransformation())
        Spacer(Modifier.height(16.dp))
        Text("NÍVEL DE ACESSO", color = web.muted, fontSize = 10.5.sp, fontWeight = FontWeight.Bold, letterSpacing = .4.sp)
        Spacer(Modifier.height(8.dp))
        RoleChoice("Administrador", "Opera a loja e gerencia a própria senha.", role == "ADMIN") { role = "ADMIN" }
        Spacer(Modifier.height(8.dp))
        RoleChoice("Mestre", "Pode criar e gerenciar outros administradores.", role == "OWNER") { role = "OWNER" }

        if (localError != null) Text(localError.orEmpty(), color = web.danger, fontSize = 10.5.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 10.dp))
        Spacer(Modifier.height(14.dp))
        WebModalActions(
            primaryText = "Criar administrador",
            onPrimary = {
                if (busy) return@WebModalActions
                localError = when {
                    name.trim().length < 2 -> "Informe o nome."
                    username.trim().length < 3 -> "Informe um usuário válido."
                    !username.matches(Regex("[a-zA-Z0-9._-]+")) -> "Usuário contém caracteres inválidos."
                    !email.contains('@') -> "Informe um e-mail válido."
                    !validPassword(password) -> "A senha deve ter ao menos 8 caracteres, uma letra e um número."
                    password != confirm -> "As senhas não coincidem."
                    else -> null
                }
                if (localError != null) return@WebModalActions
                busy = true
                onCreate(CreateAdminInput(name.trim(), username.trim(), email.trim(), password, role)) { busy = false }
            },
            onSecondary = onDismiss,
            busy = busy
        )
    }
}

@Composable
private fun PasswordModal(
    user: AdminUser,
    onDismiss: () -> Unit,
    onSave: (String, () -> Unit) -> Unit
) {
    val web = LocalRPWebColors.current
    var password by remember { mutableStateOf("") }
    var confirm by remember { mutableStateOf("") }
    var localError by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }

    WebModal(onDismiss = { if (!busy) onDismiss() }, maxWidth = 430) {
        WebModalHeader("Segurança", "Alterar senha", "Defina uma nova senha para ${user.nome}.", onClose = { if (!busy) onDismiss() })
        Text("Mínimo de 8 caracteres, com pelo menos uma letra e um número.", color = web.muted, fontSize = 10.5.sp, modifier = Modifier.padding(bottom = 12.dp))
        WebField("Senha", password, { password = it }, visualTransformation = PasswordVisualTransformation())
        Spacer(Modifier.height(12.dp))
        WebField("Confirmar", confirm, { confirm = it }, visualTransformation = PasswordVisualTransformation())
        if (localError != null) Text(localError.orEmpty(), color = web.danger, fontSize = 10.5.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 10.dp))
        Spacer(Modifier.height(14.dp))
        WebModalActions(
            primaryText = "Salvar senha",
            onPrimary = {
                if (busy) return@WebModalActions
                localError = when {
                    !validPassword(password) -> "A senha deve ter ao menos 8 caracteres, uma letra e um número."
                    password != confirm -> "As senhas não coincidem."
                    else -> null
                }
                if (localError != null) return@WebModalActions
                busy = true
                onSave(password) { busy = false }
            },
            onSecondary = onDismiss,
            busy = busy
        )
    }
}

@Composable
private fun ConfirmationModal(
    title: String,
    message: String,
    actionLabel: String,
    danger: Boolean,
    busy: Boolean,
    onDismiss: () -> Unit,
    onConfirm: () -> Unit
) {
    WebModal(onDismiss = { if (!busy) onDismiss() }, maxWidth = 420) {
        WebModalHeader("Confirmar alteração", title, message, onClose = { if (!busy) onDismiss() })
        WebModalActions(actionLabel, onConfirm, onSecondary = onDismiss, primaryDanger = danger, busy = busy)
    }
}

@Composable
private fun RoleChoice(title: String, subtitle: String, selected: Boolean, onClick: () -> Unit) {
    val web = LocalRPWebColors.current
    Surface(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(10.dp),
        color = if (selected) web.accentSoft else web.surface,
        border = BorderStroke(1.dp, if (selected) web.accent else web.borderStrong)
    ) {
        Row(modifier = Modifier.padding(10.dp), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.Top) {
            Surface(modifier = Modifier.size(18.dp), shape = RoundedCornerShape(50), color = if (selected) web.accent else web.surface, border = BorderStroke(1.dp, if (selected) web.accent else web.borderStrong)) {
                Box(contentAlignment = Alignment.Center) { if (selected) Box(Modifier.size(6.dp).background(Color.White, RoundedCornerShape(50))) }
            }
            Column {
                Text(title, color = web.text, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                Text(subtitle, color = web.muted, fontSize = 10.5.sp, lineHeight = 14.sp, modifier = Modifier.padding(top = 2.dp))
            }
        }
    }
}

private fun validPassword(value: String): Boolean = value.length >= 8 && value.any(Char::isLetter) && value.any(Char::isDigit)

private fun initials(name: String): String {
    val parts = name.trim().split(Regex("\\s+")).filter { it.isNotBlank() }
    return parts.take(2).joinToString("") { it.first().uppercase() }.ifBlank { "RP" }
}

private fun dateLabel(value: String?): String {
    if (value.isNullOrBlank()) return "—"
    return runCatching {
        Instant.parse(value).atZone(ZoneId.systemDefault()).format(DateTimeFormatter.ofPattern("dd/MM/yy"))
    }.getOrElse { value.take(10) }
}
