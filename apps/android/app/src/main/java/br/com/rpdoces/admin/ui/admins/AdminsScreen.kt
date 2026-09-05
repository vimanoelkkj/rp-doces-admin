package br.com.rpdoces.admin.ui.admins

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material3.CircularProgressIndicator
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
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import br.com.rpdoces.admin.BuildConfig
import br.com.rpdoces.admin.data.admins.AdminUser
import br.com.rpdoces.admin.data.admins.AdminsRepository
import br.com.rpdoces.admin.data.admins.CreateAdminInput
import br.com.rpdoces.admin.data.auth.AuthUser
import br.com.rpdoces.admin.ui.theme.LocalRPWebColors
import coil3.compose.AsyncImage
import kotlinx.coroutines.launch

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
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.Bottom
            ) {
                Column(modifier = Modifier.weight(1f)) {
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
        }

        if (isOwner) {
            item {
                Surface(
                    onClick = { createOpen = true },
                    modifier = Modifier.fillMaxWidth().height(42.dp),
                    shape = RoundedCornerShape(9.dp),
                    color = web.accent,
                    border = BorderStroke(1.dp, web.accentDark)
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Text("+ Novo administrador", color = Color.White, fontSize = 11.5.sp, fontWeight = FontWeight.Bold)
                    }
                }
            }

            item {
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    AccessSummary("Contas", users.size.toString(), Modifier.weight(1f))
                    AccessSummary("Ativas", activeCount.toString(), Modifier.weight(1f))
                    AccessSummary("Mestres", ownerCount.toString(), Modifier.weight(1f))
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
                    Text(error.orEmpty(), color = web.danger, fontSize = 11.5.sp, modifier = Modifier.padding(12.dp))
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
                    onToggleRole = {
                        busyId = user.id
                        feedback = null
                        scope.launch {
                            runCatching { repository.setRole(user.id, if (user.papel == "OWNER") "ADMIN" else "OWNER") }
                                .onSuccess { feedback = "Nível de acesso de ${user.nome} atualizado." }
                                .onFailure { error = it.message ?: "Não foi possível alterar o nível de acesso." }
                            reload()
                            busyId = null
                        }
                    },
                    onToggleActive = {
                        busyId = user.id
                        feedback = null
                        scope.launch {
                            runCatching { repository.setActive(user.id, !user.ativo) }
                                .onSuccess { feedback = if (user.ativo) "${user.nome} foi desativado." else "${user.nome} foi reativado." }
                                .onFailure { error = it.message ?: "Não foi possível alterar a conta." }
                            reload()
                            busyId = null
                        }
                    }
                )
            }
        }
    }

    if (createOpen) {
        CreateAdminDialog(
            onDismiss = { createOpen = false },
            onCreate = { input ->
                scope.launch {
                    runCatching { repository.create(input) }
                        .onSuccess {
                            feedback = "Administrador criado com sucesso."
                            createOpen = false
                            reload()
                        }
                        .onFailure { error = it.message ?: "Não foi possível criar o administrador." }
                }
            }
        )
    }
}

@Composable
private fun AccessSummary(label: String, value: String, modifier: Modifier = Modifier) {
    val web = LocalRPWebColors.current
    Surface(modifier = modifier, shape = RoundedCornerShape(12.dp), color = web.surfaceVeilTwo, border = BorderStroke(1.dp, web.border)) {
        Column(modifier = Modifier.padding(horizontal = 12.dp, vertical = 12.dp)) {
            Text(label, color = web.muted, fontSize = 9.5.sp, fontWeight = FontWeight.Bold)
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
    onToggleRole: () -> Unit,
    onToggleActive: () -> Unit
) {
    val web = LocalRPWebColors.current
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(14.dp),
        color = web.surfaceVeilTwo,
        border = BorderStroke(1.dp, web.border)
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Surface(modifier = Modifier.size(42.dp), shape = RoundedCornerShape(21.dp), color = web.accentSoft) {
                    Box(contentAlignment = Alignment.Center) {
                        val avatar = user.avatarUrl?.let { if (it.startsWith("http")) it else BuildConfig.API_ORIGIN + it }
                        if (!avatar.isNullOrBlank()) {
                            AsyncImage(model = avatar, contentDescription = user.nome, modifier = Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
                        } else {
                            Text(initials(user.nome), color = web.accentDark, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                        }
                    }
                }
                Column(modifier = Modifier.weight(1f)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(user.nome, color = web.text, fontSize = 13.5.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        if (isViewer) Text("Você", color = web.accentDark, fontSize = 9.5.sp, fontWeight = FontWeight.Bold)
                    }
                    Text("@${user.username}", color = web.muted, fontSize = 10.5.sp, modifier = Modifier.padding(top = 2.dp))
                    if (!user.email.isNullOrBlank()) Text(user.email, color = web.muted, fontSize = 10.5.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                Surface(shape = RoundedCornerShape(8.dp), color = if (user.ativo) web.greenSoft else web.graySoft) {
                    Text(if (user.ativo) "Ativo" else "Inativo", color = if (user.ativo) web.tagGreenText else web.muted, fontSize = 9.5.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(horizontal = 8.dp, vertical = 5.dp))
                }
            }

            HorizontalDivider(color = web.border, modifier = Modifier.padding(vertical = 14.dp))

            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Column {
                    Text("NÍVEL", color = web.muted, fontSize = 9.sp, fontWeight = FontWeight.Bold)
                    Text(if (user.papel == "OWNER") "Mestre" else "Administrador", color = web.text, fontSize = 11.5.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 3.dp))
                }
                if (isOwnerViewer && !isViewer) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        AdminAction(
                            text = if (user.papel == "OWNER") "Tornar admin" else "Tornar mestre",
                            danger = false,
                            enabled = !busy,
                            onClick = onToggleRole
                        )
                        AdminAction(
                            text = if (user.ativo) "Desativar" else "Reativar",
                            danger = user.ativo,
                            enabled = !busy,
                            onClick = onToggleActive
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun AdminAction(text: String, danger: Boolean, enabled: Boolean, onClick: () -> Unit) {
    val web = LocalRPWebColors.current
    Surface(
        onClick = onClick,
        enabled = enabled,
        shape = RoundedCornerShape(8.dp),
        color = web.surface,
        border = BorderStroke(1.dp, if (danger) web.danger.copy(alpha = .45f) else web.borderStrong)
    ) {
        Text(text, color = if (danger) web.danger else web.muted, fontSize = 9.5.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(horizontal = 9.dp, vertical = 7.dp))
    }
}

@Composable
private fun CreateAdminDialog(onDismiss: () -> Unit, onCreate: (CreateAdminInput) -> Unit) {
    val web = LocalRPWebColors.current
    var name by remember { mutableStateOf("") }
    var username by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var confirm by remember { mutableStateOf("") }
    var role by remember { mutableStateOf("ADMIN") }
    var localError by remember { mutableStateOf<String?>(null) }

    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(
            modifier = Modifier.fillMaxWidth().padding(18.dp).widthIn(max = 520.dp),
            shape = RoundedCornerShape(18.dp),
            color = web.surface,
            border = BorderStroke(1.dp, web.border)
        ) {
            Column(modifier = Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    Column {
                        Text("Novo administrador", color = web.text, fontSize = 18.sp, fontWeight = FontWeight.Bold)
                        Text("Crie uma nova conta para a equipe.", color = web.muted, fontSize = 11.sp)
                    }
                    Icon(Icons.Outlined.Close, contentDescription = "Fechar", tint = web.muted, modifier = Modifier.size(26.dp).clickable(onClick = onDismiss).padding(4.dp))
                }

                WebInput("Nome", name, { name = it })
                WebInput("Usuário", username, { username = it.lowercase() })
                WebInput("E-mail", email, { email = it.lowercase() })
                WebInput("Senha", password, { password = it }, password = true)
                WebInput("Confirmar senha", confirm, { confirm = it }, password = true)

                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    RoleButton("Administrador", role == "ADMIN", Modifier.weight(1f)) { role = "ADMIN" }
                    RoleButton("Mestre", role == "OWNER", Modifier.weight(1f)) { role = "OWNER" }
                }

                if (localError != null) Text(localError.orEmpty(), color = web.danger, fontSize = 11.sp)

                Surface(
                    onClick = {
                        localError = when {
                            name.trim().length < 2 -> "Informe o nome."
                            username.trim().length < 3 -> "Informe um usuário válido."
                            password.length < 8 -> "A senha precisa ter pelo menos 8 caracteres."
                            password != confirm -> "As senhas não coincidem."
                            else -> null
                        }
                        if (localError == null) {
                            onCreate(CreateAdminInput(name.trim(), username.trim(), email.trim(), password, role))
                        }
                    },
                    modifier = Modifier.fillMaxWidth().height(42.dp),
                    shape = RoundedCornerShape(9.dp),
                    color = web.accent,
                    border = BorderStroke(1.dp, web.accentDark)
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Text("Criar administrador", color = Color.White, fontSize = 11.5.sp, fontWeight = FontWeight.Bold)
                    }
                }
            }
        }
    }
}

@Composable
private fun WebInput(label: String, value: String, onChange: (String) -> Unit, password: Boolean = false) {
    val web = LocalRPWebColors.current
    Column {
        Text(label, color = web.muted, fontSize = 10.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(5.dp))
        Surface(modifier = Modifier.fillMaxWidth().height(42.dp), shape = RoundedCornerShape(9.dp), color = web.surface, border = BorderStroke(1.dp, web.borderStrong)) {
            BasicTextField(
                value = value,
                onValueChange = onChange,
                singleLine = true,
                visualTransformation = if (password) PasswordVisualTransformation() else androidx.compose.ui.text.input.VisualTransformation.None,
                textStyle = androidx.compose.ui.text.TextStyle(color = web.text, fontSize = 12.sp),
                modifier = Modifier.fillMaxSize().padding(horizontal = 12.dp, vertical = 12.dp)
            )
        }
    }
}

@Composable
private fun RoleButton(text: String, active: Boolean, modifier: Modifier = Modifier, onClick: () -> Unit) {
    val web = LocalRPWebColors.current
    Surface(onClick = onClick, modifier = modifier.height(38.dp), shape = RoundedCornerShape(9.dp), color = if (active) web.accentSoft else web.surface, border = BorderStroke(1.dp, if (active) web.accent else web.borderStrong)) {
        Box(contentAlignment = Alignment.Center) {
            Text(text, color = if (active) web.accentDark else web.muted, fontSize = 10.5.sp, fontWeight = FontWeight.Bold)
        }
    }
}

private fun initials(name: String): String = name.trim().split(Regex("\\s+")).filter { it.isNotBlank() }.take(2).joinToString("") { it.first().uppercase() }.ifBlank { "RP" }
