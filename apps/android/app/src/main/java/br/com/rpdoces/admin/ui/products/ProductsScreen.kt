package br.com.rpdoces.admin.ui.products

import android.net.Uri
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import br.com.rpdoces.admin.BuildConfig
import br.com.rpdoces.admin.data.products.Product
import br.com.rpdoces.admin.data.products.ProductsRepository
import br.com.rpdoces.admin.ui.theme.LocalRPWebColors
import coil3.compose.AsyncImage
import java.text.NumberFormat
import java.util.Locale
import kotlinx.coroutines.launch

private enum class ProductFilter(val label: String) {
    ALL("Todos"), ACTIVE("Ativos"), SOLD_OUT("Esgotados"), ARCHIVED("Arquivados")
}

@Composable
fun ProductsScreen(
    repository: ProductsRepository,
    modifier: Modifier = Modifier
) {
    val web = LocalRPWebColors.current
    val scope = rememberCoroutineScope()
    var products by remember { mutableStateOf<List<Product>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var query by remember { mutableStateOf("") }
    var filter by remember { mutableStateOf(ProductFilter.ALL) }
    var busyId by remember { mutableStateOf<Int?>(null) }

    suspend fun reload() {
        try {
            products = repository.list()
            error = null
        } catch (t: Throwable) {
            error = t.message ?: "Não foi possível carregar os produtos."
        } finally {
            loading = false
        }
    }

    LaunchedEffect(Unit) { reload() }

    val normalizedQuery = query.trim().lowercase(Locale("pt", "BR"))
    val visible = products.filter { product ->
        val searchText = "${product.nome} ${product.descricao} ${product.categoryName.orEmpty()} ${product.categoria}".lowercase(Locale("pt", "BR"))
        val matchesQuery = normalizedQuery.isBlank() || normalizedQuery in searchText
        val matchesFilter = when (filter) {
            ProductFilter.ALL -> true
            ProductFilter.ACTIVE -> product.ativo
            ProductFilter.SOLD_OUT -> product.ativo && product.availableStock <= 0
            ProductFilter.ARCHIVED -> !product.ativo
        }
        matchesQuery && matchesFilter
    }

    val activeCount = products.count { it.ativo }
    val soldOutCount = products.count { it.ativo && it.availableStock <= 0 }

    Column(modifier = modifier.fillMaxSize()) {
        Column(modifier = Modifier.padding(horizontal = 12.dp)) {
            ProductSearch(query = query, onQueryChange = { query = it })
            Spacer(Modifier.height(14.dp))

            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(14.dp)
            ) {
                ProductFilter.entries.forEach { item ->
                    val active = filter == item
                    Column(
                        modifier = Modifier
                            .clickable { filter = item }
                            .padding(horizontal = 2.dp, vertical = 8.dp),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Text(
                            item.label,
                            color = if (active) web.accentDark else web.muted,
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Bold
                        )
                        Spacer(Modifier.height(6.dp))
                        Box(
                            modifier = Modifier
                                .width(44.dp)
                                .height(2.dp)
                                .background(if (active) web.accent else androidx.compose.ui.graphics.Color.Transparent)
                        )
                    }
                }
            }

            Spacer(Modifier.height(10.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                ProductActionButton(
                    text = "Gerenciar categorias",
                    primary = false,
                    modifier = Modifier.weight(1f),
                    onClick = { }
                )
                ProductActionButton(
                    text = "+ Novo produto",
                    primary = true,
                    modifier = Modifier.weight(1f),
                    onClick = { }
                )
            }

            Text(
                text = if (loading) "Carregando catálogo…" else "${products.size} produtos · $activeCount ativos · $soldOutCount esgotados",
                color = web.muted,
                fontSize = 12.5.sp,
                modifier = Modifier.padding(start = 4.dp, top = 14.dp, bottom = 12.dp)
            )

            if (error != null) {
                Surface(
                    modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp),
                    shape = RoundedCornerShape(10.dp),
                    color = web.accentSoft
                ) {
                    Row(
                        modifier = Modifier.padding(12.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(error.orEmpty(), color = web.danger, fontSize = 11.5.sp, modifier = Modifier.weight(1f))
                        Text(
                            "Tentar novamente",
                            color = web.accentDark,
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold,
                            modifier = Modifier.clickable { loading = true; scope.launch { reload() } }.padding(8.dp)
                        )
                    }
                }
            }
        }

        if (loading && products.isEmpty()) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = web.accent)
            }
        } else if (visible.isEmpty()) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
                Text("Nenhum produto encontrado.", color = web.muted, fontSize = 12.sp, modifier = Modifier.padding(top = 28.dp))
            }
        } else {
            LazyVerticalGrid(
                columns = GridCells.Fixed(2),
                modifier = Modifier.fillMaxSize(),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(start = 12.dp, end = 12.dp, bottom = 24.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                items(visible, key = { it.id }) { product ->
                    ProductCard(
                        product = product,
                        busy = busyId == product.id,
                        onArchive = {
                            busyId = product.id
                            scope.launch {
                                runCatching { repository.archive(product.id) }
                                    .onFailure { error = it.message ?: "Não foi possível arquivar o produto." }
                                reload()
                                busyId = null
                            }
                        },
                        onRestore = {
                            busyId = product.id
                            scope.launch {
                                runCatching { repository.restore(product) }
                                    .onFailure { error = it.message ?: "Não foi possível restaurar o produto." }
                                reload()
                                busyId = null
                            }
                        },
                        onDelete = {
                            busyId = product.id
                            scope.launch {
                                runCatching { repository.deletePermanently(product.id) }
                                    .onFailure { error = it.message ?: "Não foi possível excluir o produto." }
                                reload()
                                busyId = null
                            }
                        }
                    )
                }
            }
        }
    }
}

@Composable
private fun ProductSearch(query: String, onQueryChange: (String) -> Unit) {
    val web = LocalRPWebColors.current
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(44.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(Icons.Outlined.Search, contentDescription = null, tint = web.muted, modifier = Modifier.size(18.dp))
        Spacer(Modifier.width(8.dp))
        BasicTextField(
            value = query,
            onValueChange = onQueryChange,
            singleLine = true,
            textStyle = MaterialTheme.typography.bodyMedium.copy(color = web.text, fontSize = 12.5.sp),
            modifier = Modifier.weight(1f),
            decorationBox = { inner ->
                Box {
                    if (query.isBlank()) Text("Buscar produto", color = web.muted, fontSize = 12.5.sp)
                    inner()
                }
            }
        )
    }
    Box(modifier = Modifier.fillMaxWidth().height(2.dp).background(web.borderStrong))
}

@Composable
private fun ProductActionButton(text: String, primary: Boolean, modifier: Modifier = Modifier, onClick: () -> Unit) {
    val web = LocalRPWebColors.current
    Surface(
        onClick = onClick,
        modifier = modifier.height(38.dp),
        shape = RoundedCornerShape(9.dp),
        color = if (primary) web.accent else web.surface,
        border = BorderStroke(1.dp, if (primary) web.accentDark else web.borderStrong)
    ) {
        Box(contentAlignment = Alignment.Center) {
            Text(text, color = if (primary) androidx.compose.ui.graphics.Color.White else web.muted, fontSize = 11.5.sp, fontWeight = FontWeight.Bold)
        }
    }
}

@Composable
private fun ProductCard(
    product: Product,
    busy: Boolean,
    onArchive: () -> Unit,
    onRestore: () -> Unit,
    onDelete: () -> Unit
) {
    val web = LocalRPWebColors.current
    var menuOpen by remember { mutableStateOf(false) }

    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        color = web.surface,
        border = BorderStroke(1.dp, web.border)
    ) {
        Column {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(118.dp)
                    .background(web.graySoft),
                contentAlignment = Alignment.Center
            ) {
                if (!product.imageKey.isNullOrBlank()) {
                    AsyncImage(
                        model = BuildConfig.API_ORIGIN + "/api/images/" + Uri.encode(product.imageKey),
                        contentDescription = product.nome,
                        modifier = Modifier.fillMaxSize(),
                        contentScale = ContentScale.Crop
                    )
                } else {
                    Text(product.emoji ?: "🍰", fontSize = 38.sp)
                }

                Row(
                    modifier = Modifier.align(Alignment.TopStart).padding(7.dp),
                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    if (product.destaque) ProductFlag("Destaque")
                    if (!product.ativo) ProductFlag("Arquivado")
                    if (product.ativo && !product.disponivel) ProductFlag("Indisponível")
                }

                if (product.promotionActive && product.promotionalPriceCents != null) {
                    Surface(
                        modifier = Modifier.align(Alignment.BottomEnd).padding(7.dp),
                        shape = RoundedCornerShape(99.dp),
                        color = web.tagGreenText
                    ) {
                        Text("Promoção ativa", color = androidx.compose.ui.graphics.Color.White, fontSize = 8.5.sp, fontWeight = FontWeight.ExtraBold, modifier = Modifier.padding(horizontal = 6.dp, vertical = 3.dp))
                    }
                }
            }

            Column(modifier = Modifier.padding(horizontal = 10.dp, vertical = 10.dp)) {
                Row(verticalAlignment = Alignment.Top) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = "${product.categoryEmoji.orEmpty()} ${product.categoryName ?: product.categoria}".trim(),
                            color = web.muted,
                            fontSize = 9.5.sp,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                        Text(
                            text = product.nome,
                            color = web.text,
                            fontSize = 12.5.sp,
                            lineHeight = 17.sp,
                            fontWeight = FontWeight.Bold,
                            minLines = 2,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis
                        )
                    }

                    Box {
                        Text(
                            text = if (busy) "…" else "•••",
                            color = web.muted,
                            fontSize = 10.sp,
                            fontWeight = FontWeight.ExtraBold,
                            modifier = Modifier.clickable(enabled = !busy) { menuOpen = true }.padding(6.dp)
                        )
                        DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                            if (product.ativo) {
                                DropdownMenuItem(text = { Text("Arquivar") }, onClick = { menuOpen = false; onArchive() })
                            } else {
                                DropdownMenuItem(text = { Text("Restaurar") }, onClick = { menuOpen = false; onRestore() })
                            }
                            HorizontalDivider()
                            DropdownMenuItem(text = { Text("Excluir permanentemente", color = web.danger) }, onClick = { menuOpen = false; onDelete() })
                        }
                    }
                }

                Spacer(Modifier.height(8.dp))
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.Bottom) {
                        if (product.currentPriceCents != product.priceCents) {
                            Text(money(product.priceCents), color = web.muted, fontSize = 9.sp)
                        }
                        Text(money(product.currentPriceCents), color = web.text, fontSize = 13.5.sp, fontWeight = FontWeight.Bold)
                    }
                    Text(
                        if (product.availableStock > 0) "${product.availableStock} em estoque" else "Esgotado",
                        color = if (product.availableStock <= 3) web.tagOrangeText else web.tagGreenText,
                        fontSize = 9.5.sp,
                        fontWeight = FontWeight.Bold
                    )
                }
            }
        }
    }
}

@Composable
private fun ProductFlag(text: String) {
    val web = LocalRPWebColors.current
    Surface(shape = RoundedCornerShape(6.dp), color = web.surface) {
        Text(text, color = web.accentDark, fontSize = 8.sp, fontWeight = FontWeight.ExtraBold, modifier = Modifier.padding(horizontal = 5.dp, vertical = 3.dp))
    }
}

private fun money(cents: Int): String = NumberFormat.getCurrencyInstance(Locale("pt", "BR")).format(cents / 100.0)
