package br.com.rpdoces.admin.ui.products

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.core.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenuItem
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
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import br.com.rpdoces.admin.BuildConfig
import br.com.rpdoces.admin.data.products.Category
import br.com.rpdoces.admin.data.products.CategoryInput
import br.com.rpdoces.admin.data.products.Product
import br.com.rpdoces.admin.data.products.ProductInput
import br.com.rpdoces.admin.data.products.ProductsRepository
import br.com.rpdoces.admin.ui.components.MotionChevron
import br.com.rpdoces.admin.ui.components.MotionDropdownMenu
import br.com.rpdoces.admin.ui.components.MotionValue
import br.com.rpdoces.admin.ui.components.RPMotion
import br.com.rpdoces.admin.ui.components.WebField
import br.com.rpdoces.admin.ui.components.WebModal
import br.com.rpdoces.admin.ui.components.WebModalActions
import br.com.rpdoces.admin.ui.components.WebModalHeader
import br.com.rpdoces.admin.ui.theme.LocalRPWebColors
import coil3.compose.AsyncImage
import java.text.NumberFormat
import java.util.Locale
import kotlin.math.roundToInt
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private val emojiOptions = listOf("🍰", "🧁", "🍮", "🎂", "🍓", "🍫", "🥥", "🍋", "🍯", "🍪")

@Composable
internal fun ProductEditorDialog(
    repository: ProductsRepository,
    product: Product?,
    onDismiss: () -> Unit,
    onSaved: () -> Unit
) {
    val web = LocalRPWebColors.current
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    var categories by remember { mutableStateOf<List<Category>>(emptyList()) }
    var categoryOpen by remember { mutableStateOf(false) }
    var name by remember(product?.id) { mutableStateOf(product?.nome.orEmpty()) }
    var category by remember(product?.id) { mutableStateOf(product?.categoria.orEmpty()) }
    var stock by remember(product?.id) { mutableStateOf((product?.estoque ?: 0).toString()) }
    var emoji by remember(product?.id) { mutableStateOf(product?.emoji ?: "🍰") }
    var price by remember(product?.id) { mutableStateOf(centsToInput(product?.priceCents ?: 0)) }
    var description by remember(product?.id) { mutableStateOf(product?.descricao.orEmpty()) }
    var active by remember(product?.id) { mutableStateOf(product?.ativo ?: true) }
    var available by remember(product?.id) { mutableStateOf(product?.disponivel ?: true) }
    var featured by remember(product?.id) { mutableStateOf(product?.destaque ?: false) }
    var promotion by remember(product?.id) { mutableStateOf(product?.promotionActive ?: false) }
    var promoPrice by remember(product?.id) { mutableStateOf(product?.promotionalPriceCents?.let(::centsToInput).orEmpty()) }
    var promoStart by remember(product?.id) { mutableStateOf(product?.promotionStart.orEmpty()) }
    var promoEnd by remember(product?.id) { mutableStateOf(product?.promotionEnd.orEmpty()) }
    var pickedUri by remember(product?.id) { mutableStateOf<Uri?>(null) }
    var removeImage by remember(product?.id) { mutableStateOf(false) }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    val imagePicker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri != null) {
            pickedUri = uri
            removeImage = false
        }
    }

    LaunchedEffect(product?.id) {
        runCatching { repository.activeCategories() }
            .onSuccess {
                categories = it
                if (category.isBlank()) category = it.firstOrNull()?.id.orEmpty()
            }
            .onFailure { error = it.message ?: "Não foi possível carregar as categorias." }
    }

    WebModal(onDismiss = { if (!saving) onDismiss() }) {
        WebModalHeader(
            kicker = "Catálogo",
            title = if (product == null) "Novo produto" else "Editar produto",
            subtitle = if (product == null) "Cadastre um doce e ele já entra no catálogo administrativo." else "Atualize os dados do produto no catálogo administrativo.",
            onClose = { if (!saving) onDismiss() }
        )

        WebField("Nome", name, { name = it }, placeholder = "Ex.: Bolo no pote de morango")
        Spacer(Modifier.height(18.dp))

        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Column(modifier = Modifier.weight(1f)) {
                Text("CATEGORIA", color = web.muted, fontSize = 10.5.sp, fontWeight = FontWeight.Bold, letterSpacing = .4.sp)
                Spacer(Modifier.height(8.dp))
                Box {
                    Surface(
                        onClick = { categoryOpen = true },
                        modifier = Modifier.fillMaxWidth().height(40.dp),
                        shape = RoundedCornerShape(9.dp),
                        color = web.surface,
                        border = BorderStroke(1.dp, web.borderStrong)
                    ) {
                        Row(modifier = Modifier.fillMaxSize().padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                            val selected = categories.firstOrNull { it.id == category }
                            val selectedLabel = "${selected?.emoji.orEmpty()} ${selected?.nome ?: category}".trim()
                            MotionValue(targetState = selectedLabel, modifier = Modifier.weight(1f)) { label ->
                                Text(label, color = web.text, fontSize = 12.5.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            }
                            MotionChevron(expanded = categoryOpen, tint = web.muted, modifier = Modifier.size(18.dp))
                        }
                    }
                    MotionDropdownMenu(expanded = categoryOpen, onDismissRequest = { categoryOpen = false }) {
                        categories.forEach { item ->
                            DropdownMenuItem(
                                text = { Text("${item.emoji} ${item.nome}".trim()) },
                                onClick = { category = item.id; categoryOpen = false }
                            )
                        }
                    }
                }
            }

            Column(modifier = Modifier.weight(1f)) {
                Text("ESTOQUE", color = web.muted, fontSize = 10.5.sp, fontWeight = FontWeight.Bold, letterSpacing = .4.sp)
                Spacer(Modifier.height(8.dp))
                Surface(
                    modifier = Modifier.fillMaxWidth().height(40.dp),
                    shape = RoundedCornerShape(9.dp),
                    color = web.surface,
                    border = BorderStroke(1.dp, web.borderStrong)
                ) {
                    Row(modifier = Modifier.fillMaxSize(), verticalAlignment = Alignment.CenterVertically) {
                        StepButton("−") { stock = ((stock.toIntOrNull() ?: 0) - 1).coerceAtLeast(product?.reservedStock ?: 0).toString() }
                        Box(modifier = Modifier.weight(1f).height(40.dp), contentAlignment = Alignment.Center) {
                            MotionValue(targetState = stock) { value ->
                                Text(value, color = web.text, fontSize = 14.sp, fontWeight = FontWeight.Bold)
                            }
                        }
                        StepButton("+") { stock = ((stock.toIntOrNull() ?: 0) + 1).coerceAtMost(100000).toString() }
                    }
                }
                if ((product?.reservedStock ?: 0) > 0) {
                    Text("${product?.reservedStock} reservada(s)", color = web.muted, fontSize = 9.5.sp, modifier = Modifier.padding(top = 5.dp))
                }
            }
        }

        Spacer(Modifier.height(18.dp))
        Text("EMOJI", color = web.muted, fontSize = 10.5.sp, fontWeight = FontWeight.Bold, letterSpacing = .4.sp)
        Spacer(Modifier.height(8.dp))
        Row(modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            emojiOptions.forEach { option ->
                val selected = emoji == option
                val scale by animateFloatAsState(
                    targetValue = if (selected) 1.08f else 1f,
                    animationSpec = tween(RPMotion.Normal, easing = RPMotion.EaseOut),
                    label = "emoji-$option"
                )
                val borderColor by animateColorAsState(
                    targetValue = if (selected) web.accent else web.borderStrong,
                    animationSpec = tween(RPMotion.Fast),
                    label = "emoji-border-$option"
                )
                val fillColor by animateColorAsState(
                    targetValue = if (selected) web.accentSoft else web.surface,
                    animationSpec = tween(RPMotion.Fast),
                    label = "emoji-fill-$option"
                )
                Surface(
                    onClick = { emoji = option },
                    modifier = Modifier.size(54.dp).graphicsLayer { scaleX = scale; scaleY = scale },
                    shape = RoundedCornerShape(10.dp),
                    color = fillColor,
                    border = BorderStroke(1.dp, borderColor)
                ) {
                    Box(contentAlignment = Alignment.Center) { Text(option, fontSize = 20.sp) }
                }
            }
        }

        Spacer(Modifier.height(18.dp))
        WebField("Preço", price, { price = it.filter { ch -> ch.isDigit() || ch == ',' || ch == '.' } }, placeholder = "0,00")
        Spacer(Modifier.height(18.dp))

        Text("FOTO", color = web.muted, fontSize = 10.5.sp, fontWeight = FontWeight.Bold, letterSpacing = .4.sp)
        Spacer(Modifier.height(8.dp))
        Surface(
            modifier = Modifier.fillMaxWidth().height(150.dp),
            shape = RoundedCornerShape(12.dp),
            color = web.graySoft,
            border = BorderStroke(1.dp, web.borderStrong)
        ) {
            val remote = product?.imageKey?.takeUnless { removeImage }?.let { BuildConfig.API_ORIGIN + "/api/images/" + Uri.encode(it) }
            val model: Any? = pickedUri ?: remote
            if (model != null) {
                AsyncImage(model = model, contentDescription = name, modifier = Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
            } else {
                Box(contentAlignment = Alignment.Center) { Text(emoji.ifBlank { "🍰" }, fontSize = 40.sp) }
            }
        }
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(16.dp, Alignment.End)) {
            Surface(onClick = { imagePicker.launch("image/*") }, color = Color.Transparent) {
                Text(if (pickedUri != null || (!product?.imageKey.isNullOrBlank() && !removeImage)) "Trocar foto" else "Adicionar foto", color = web.accentDark, fontSize = 11.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(vertical = 9.dp))
            }
            if (pickedUri != null || !product?.imageKey.isNullOrBlank()) {
                Surface(onClick = { pickedUri = null; removeImage = true }, color = Color.Transparent) {
                    Text("Remover", color = web.danger, fontSize = 11.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(vertical = 9.dp))
                }
            }
        }

        Spacer(Modifier.height(10.dp))
        WebField("Descrição", description, { description = it.take(500) }, placeholder = "Uma descrição curta do produto.", singleLine = false, minHeight = 78)
        Spacer(Modifier.height(18.dp))

        ToggleCard("Produto ativo", "Disponível para aparecer no catálogo.", active) {
            active = !active
            if (!active) available = false
        }
        Spacer(Modifier.height(8.dp))
        ToggleCard("Marcar como destaque", "Exibe o selo de destaque no produto.", featured) { featured = !featured }
        Spacer(Modifier.height(8.dp))
        ToggleCard("Disponível para venda", "Controla a disponibilidade sem arquivar.", available, enabled = active) { if (active) available = !available }
        Spacer(Modifier.height(8.dp))
        ToggleCard("Promoção", "Ativa preço promocional e agendamento.", promotion) { promotion = !promotion }

        AnimatedVisibility(
            visible = promotion,
            enter = fadeIn(tween(RPMotion.Fast)) + expandVertically(tween(RPMotion.Normal, easing = RPMotion.EaseOut)),
            exit = fadeOut(tween(RPMotion.Quick)) + shrinkVertically(tween(RPMotion.Fast))
        ) {
            Column {
                Spacer(Modifier.height(12.dp))
                Surface(shape = RoundedCornerShape(12.dp), color = web.accentSoft, border = BorderStroke(1.dp, web.pinkBorder)) {
                    Column(modifier = Modifier.padding(14.dp)) {
                        Text("Configuração da promoção", color = web.text, fontSize = 13.sp, fontWeight = FontWeight.Bold)
                        Text("Início e fim são opcionais. Sem datas, a promoção vale imediatamente.", color = web.muted, fontSize = 10.5.sp, lineHeight = 15.sp, modifier = Modifier.padding(top = 3.dp))
                        Spacer(Modifier.height(12.dp))
                        WebField("Preço promocional", promoPrice, { promoPrice = it.filter { ch -> ch.isDigit() || ch == ',' || ch == '.' } }, placeholder = "0,00")
                        Spacer(Modifier.height(12.dp))
                        WebField("Início", promoStart, { promoStart = it }, placeholder = "2026-09-05T18:00:00")
                        Spacer(Modifier.height(12.dp))
                        WebField("Fim", promoEnd, { promoEnd = it }, placeholder = "2026-09-10T23:59:00")
                    }
                }
            }
        }

        if (error != null) {
            Text(error.orEmpty(), color = web.danger, fontSize = 11.5.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 14.dp))
        }

        Spacer(Modifier.height(14.dp))
        WebModalActions(
            primaryText = "Salvar produto",
            onPrimary = {
                if (saving) return@WebModalActions
                val priceCents = inputToCents(price)
                val promoCents = promoPrice.takeIf { it.isNotBlank() }?.let(::inputToCents)
                error = when {
                    name.trim().isBlank() -> "Nome é obrigatório."
                    category.isBlank() -> "Categoria é obrigatória."
                    priceCents <= 0 -> "Preço deve ser maior que zero."
                    (stock.toIntOrNull() ?: -1) < (product?.reservedStock ?: 0) -> "O estoque não pode ser menor que o reservado."
                    promotion && (promoCents == null || promoCents <= 0) -> "Informe o preço promocional."
                    promotion && promoCents != null && promoCents >= priceCents -> "Preço promocional deve ser menor que o preço normal."
                    else -> null
                }
                if (error != null) return@WebModalActions

                saving = true
                scope.launch {
                    runCatching {
                        val input = ProductInput(
                            nome = name.trim(),
                            categoria = category,
                            descricao = description.trim(),
                            priceCents = priceCents,
                            disponivel = available,
                            ativo = active,
                            destaque = featured,
                            emoji = emoji,
                            estoque = stock.toIntOrNull()?.coerceIn(0, 100000) ?: 0,
                            promotionActive = promotion,
                            promotionalPriceCents = if (promotion) promoCents else null,
                            promotionStart = if (promotion) promoStart.trim().ifBlank { null } else null,
                            promotionEnd = if (promotion) promoEnd.trim().ifBlank { null } else null
                        )
                        val id = if (product == null) repository.create(input) else {
                            repository.update(product.id, input)
                            product.id
                        }
                        if (removeImage && product?.imageKey != null) repository.deleteImage(id)
                        pickedUri?.let { uri ->
                            val mime = context.contentResolver.getType(uri) ?: "image/jpeg"
                            val bytes = withContext(Dispatchers.IO) {
                                context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
                                    ?: error("Não foi possível ler a imagem.")
                            }
                            repository.uploadImage(id, bytes, "produto-$id.${mime.substringAfter('/').ifBlank { "jpg" }}", mime)
                        }
                    }.onSuccess {
                        onSaved()
                        onDismiss()
                    }.onFailure {
                        error = it.message ?: "Não foi possível salvar o produto."
                    }
                    saving = false
                }
            },
            onSecondary = onDismiss,
            busy = saving
        )
    }
}

@Composable
internal fun CategoryManagerDialog(
    repository: ProductsRepository,
    onDismiss: () -> Unit
) {
    val web = LocalRPWebColors.current
    val scope = rememberCoroutineScope()
    var categories by remember { mutableStateOf<List<Category>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var saving by remember { mutableStateOf(false) }
    var name by remember { mutableStateOf("") }
    var emoji by remember { mutableStateOf("🍰") }
    var description by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var message by remember { mutableStateOf<String?>(null) }

    suspend fun reload() {
        runCatching { repository.categories() }
            .onSuccess { categories = it; error = null }
            .onFailure { error = it.message ?: "Não foi possível carregar as categorias." }
        loading = false
    }

    LaunchedEffect(Unit) { reload() }

    WebModal(onDismiss = { if (!saving) onDismiss() }, maxWidth = 560) {
        WebModalHeader("Catálogo", "Gerenciar categorias", "Crie categorias e use-as imediatamente nos produtos do cardápio.", onDismiss)

        Surface(shape = RoundedCornerShape(12.dp), color = web.surfaceSoft, border = BorderStroke(1.dp, web.border)) {
            Column(modifier = Modifier.padding(14.dp)) {
                Text("Nova categoria", color = web.text, fontSize = 13.sp, fontWeight = FontWeight.Bold)
                Text("O identificador é criado automaticamente a partir do nome.", color = web.muted, fontSize = 10.5.sp, modifier = Modifier.padding(top = 2.dp))
                Spacer(Modifier.height(12.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    WebField("Nome", name, { name = it.take(60) }, Modifier.weight(1f), placeholder = "Ex.: Brownies")
                    WebField("Emoji", emoji, { emoji = it.take(16) }, Modifier.width(88.dp))
                }
                Spacer(Modifier.height(10.dp))
                WebField("Descrição", description, { description = it.take(240) }, placeholder = "Ex.: Brownies artesanais da R&P")
                Spacer(Modifier.height(10.dp))
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                    Surface(
                        onClick = {
                            if (saving) return@Surface
                            if (name.trim().length < 2) { error = "Informe um nome com pelo menos 2 caracteres."; return@Surface }
                            saving = true
                            error = null
                            message = null
                            scope.launch {
                                runCatching { repository.createCategory(CategoryInput(name.trim(), emoji.trim().ifBlank { "🍰" }, description.trim())) }
                                    .onSuccess {
                                        name = ""; emoji = "🍰"; description = ""; message = "Categoria criada."
                                        reload()
                                    }
                                    .onFailure { error = it.message ?: "Não foi possível criar a categoria." }
                                saving = false
                            }
                        },
                        color = Color.Transparent
                    ) {
                        MotionValue(targetState = if (saving) "Criando…" else "+ Criar categoria") { label ->
                            Text(label, color = web.accentDark, fontSize = 11.5.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(vertical = 9.dp))
                        }
                    }
                }
            }
        }

        if (message != null) Text(message.orEmpty(), color = web.tagGreenText, fontSize = 11.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 12.dp))
        if (error != null) Text(error.orEmpty(), color = web.danger, fontSize = 11.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 12.dp))

        Spacer(Modifier.height(14.dp))
        if (loading) {
            Box(modifier = Modifier.fillMaxWidth().height(100.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = web.accent, modifier = Modifier.size(22.dp), strokeWidth = 2.dp) }
        } else {
            categories.forEachIndexed { index, item ->
                if (index > 0) HorizontalDivider(color = web.border)
                Row(modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Surface(modifier = Modifier.size(42.dp), shape = RoundedCornerShape(12.dp), color = web.graySoft) {
                        Box(contentAlignment = Alignment.Center) { Text(item.emoji.ifBlank { "🍰" }, fontSize = 20.sp) }
                    }
                    Column(modifier = Modifier.weight(1f)) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                            Text(item.nome, color = web.text, fontSize = 12.5.sp, fontWeight = FontWeight.Bold)
                            Text(if (item.sistema) "Sistema" else "Personalizada", color = if (item.sistema) web.muted else web.accentDark, fontSize = 9.sp, fontWeight = FontWeight.Bold)
                        }
                        Text(item.id, color = web.muted, fontSize = 9.5.sp, modifier = Modifier.padding(top = 2.dp))
                        Text(item.descricao ?: "Categoria personalizada do cardápio.", color = web.muted, fontSize = 10.5.sp, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 4.dp))
                        Text("${item.produtos} produtos · ${item.ativos} ativos · ${item.arquivados} arquivados", color = web.muted, fontSize = 9.5.sp, modifier = Modifier.padding(top = 5.dp))
                    }
                }
            }
        }
        Spacer(Modifier.height(10.dp))
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text("${categories.size} ${if (categories.size == 1) "categoria" else "categorias"} no catálogo", color = web.muted, fontSize = 10.5.sp)
            Surface(onClick = onDismiss, color = Color.Transparent) { Text("Fechar", color = web.muted, fontSize = 11.5.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(vertical = 9.dp)) }
        }
    }
}

@Composable
internal fun ProductPreviewDialog(product: Product, onDismiss: () -> Unit) {
    val web = LocalRPWebColors.current
    WebModal(onDismiss = onDismiss) {
        WebModalHeader("Catálogo", product.nome, "Visualização rápida do produto.", onDismiss)
        Surface(modifier = Modifier.fillMaxWidth().height(230.dp), shape = RoundedCornerShape(14.dp), color = web.graySoft) {
            if (!product.imageKey.isNullOrBlank()) {
                AsyncImage(model = BuildConfig.API_ORIGIN + "/api/images/" + Uri.encode(product.imageKey), contentDescription = product.nome, modifier = Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
            } else {
                Box(contentAlignment = Alignment.Center) { Text(product.emoji ?: "🍰", fontSize = 54.sp) }
            }
        }
        Spacer(Modifier.height(14.dp))
        Text("${product.categoryEmoji.orEmpty()} ${product.categoryName ?: product.categoria}".trim(), color = web.muted, fontSize = 10.5.sp)
        Text(product.nome, color = web.text, fontSize = 18.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 3.dp))
        Text(product.descricao.ifBlank { "Sem descrição cadastrada." }, color = web.muted, fontSize = 11.5.sp, lineHeight = 17.sp, modifier = Modifier.padding(top = 8.dp))
        HorizontalDivider(color = web.border, modifier = Modifier.padding(vertical = 14.dp))
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Column {
                Text("PREÇO", color = web.muted, fontSize = 9.5.sp, fontWeight = FontWeight.Bold)
                Text(money(product.currentPriceCents), color = web.text, fontSize = 16.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 4.dp))
            }
            Column(horizontalAlignment = Alignment.End) {
                Text("ESTOQUE", color = web.muted, fontSize = 9.5.sp, fontWeight = FontWeight.Bold)
                Text(if (product.availableStock > 0) "${product.availableStock} disponível(is)" else "Esgotado", color = if (product.availableStock <= 3) web.tagOrangeText else web.tagGreenText, fontSize = 11.5.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 4.dp))
            }
        }
    }
}

@Composable
internal fun ProductConfirmDialog(
    title: String,
    message: String,
    actionLabel: String,
    danger: Boolean,
    busy: Boolean,
    onDismiss: () -> Unit,
    onConfirm: () -> Unit
) {
    val web = LocalRPWebColors.current
    WebModal(onDismiss = { if (!busy) onDismiss() }, maxWidth = 420) {
        WebModalHeader("Catálogo", title, message, onDismiss)
        if (danger) {
            Text("Esta ação não pode ser desfeita.", color = web.danger, fontSize = 10.5.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(bottom = 10.dp))
        }
        WebModalActions(actionLabel, onConfirm, onSecondary = onDismiss, primaryDanger = danger, busy = busy)
    }
}

@Composable
private fun StepButton(text: String, onClick: () -> Unit) {
    val web = LocalRPWebColors.current
    Surface(onClick = onClick, modifier = Modifier.width(38.dp).height(40.dp), color = Color.Transparent) {
        Box(contentAlignment = Alignment.Center) { Text(text, color = web.accentDark, fontSize = 16.sp, fontWeight = FontWeight.Bold) }
    }
}

@Composable
private fun ToggleCard(title: String, subtitle: String, checked: Boolean, enabled: Boolean = true, onClick: () -> Unit) {
    val web = LocalRPWebColors.current
    val borderColor by animateColorAsState(
        targetValue = if (checked) web.accent else web.borderStrong,
        animationSpec = tween(RPMotion.Fast),
        label = "toggle-border-$title"
    )
    val checkColor by animateColorAsState(
        targetValue = if (checked) web.accent else web.surface,
        animationSpec = tween(RPMotion.Fast),
        label = "toggle-fill-$title"
    )
    val checkScale by animateFloatAsState(
        targetValue = if (checked) 1f else .82f,
        animationSpec = tween(RPMotion.Normal, easing = RPMotion.EaseOut),
        label = "toggle-check-$title"
    )
    Surface(
        onClick = onClick,
        enabled = enabled,
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(10.dp),
        color = web.surface,
        border = BorderStroke(1.dp, borderColor)
    ) {
        Row(modifier = Modifier.padding(10.dp), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.Top) {
            Surface(modifier = Modifier.size(18.dp), shape = RoundedCornerShape(4.dp), color = checkColor, border = BorderStroke(1.dp, borderColor)) {
                Box(contentAlignment = Alignment.Center) {
                    if (checked) Text("✓", color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.Bold, modifier = Modifier.graphicsLayer { scaleX = checkScale; scaleY = checkScale })
                }
            }
            Column(modifier = Modifier.weight(1f)) {
                Text(title, color = if (enabled) web.text else web.muted, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                Text(subtitle, color = web.muted, fontSize = 10.5.sp, lineHeight = 14.sp, modifier = Modifier.padding(top = 2.dp))
            }
        }
    }
}

private fun inputToCents(value: String): Int {
    val normalized = value.trim().replace(" ", "").replace(",", ".")
    return ((normalized.toDoubleOrNull() ?: 0.0) * 100.0).roundToInt()
}

private fun centsToInput(cents: Int): String = String.format(Locale("pt", "BR"), "%.2f", cents / 100.0)
private fun money(cents: Int): String = NumberFormat.getCurrencyInstance(Locale("pt", "BR")).format(cents / 100.0)