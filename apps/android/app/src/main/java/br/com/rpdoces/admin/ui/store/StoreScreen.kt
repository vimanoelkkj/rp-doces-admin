package br.com.rpdoces.admin.ui.store

import android.net.Uri
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
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
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import br.com.rpdoces.admin.BuildConfig
import br.com.rpdoces.admin.data.store.StoreConfig
import br.com.rpdoces.admin.data.store.StoreRepository
import br.com.rpdoces.admin.data.store.StoreUpdateInput
import br.com.rpdoces.admin.ui.theme.LocalRPWebColors
import coil3.compose.AsyncImage
import kotlinx.coroutines.launch

private val storeDays = listOf(
    "seg" to "Seg", "ter" to "Ter", "qua" to "Qua", "qui" to "Qui",
    "sex" to "Sex", "sab" to "Sáb", "dom" to "Dom"
)

private val deliveryOptions = listOf(
    "EM_BREVE" to "Em breve",
    "DISPONIVEL" to "Disponíveis",
    "INDISPONIVEL" to "Indisponíveis"
)

@Composable
fun StoreScreen(
    repository: StoreRepository,
    modifier: Modifier = Modifier
) {
    val web = LocalRPWebColors.current
    val scope = rememberCoroutineScope()
    var config by remember { mutableStateOf<StoreConfig?>(null) }
    var loading by remember { mutableStateOf(true) }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var status by remember { mutableStateOf<String?>(null) }

    var whatsapp by remember { mutableStateOf("") }
    var pickupLocation by remember { mutableStateOf("") }
    var address by remember { mutableStateOf("") }
    var mapsUrl by remember { mutableStateOf("") }
    var deliveryStatus by remember { mutableStateOf("EM_BREVE") }
    var activeDays by remember { mutableStateOf(setOf("seg", "ter", "qua", "qui", "sex", "sab")) }
    var opensAt by remember { mutableStateOf("10:00") }
    var closesAt by remember { mutableStateOf("19:00") }
    var whatsappMessage by remember { mutableStateOf("") }

    suspend fun load() {
        try {
            val next = repository.get()
            config = next
            whatsapp = next.whatsapp
            pickupLocation = next.pickupLocation
            address = next.endereco
            mapsUrl = next.mapsUrl
            deliveryStatus = next.deliveryStatus.takeIf { value -> deliveryOptions.any { it.first == value } } ?: "EM_BREVE"
            activeDays = next.scheduleDays.split(',').map { it.trim() }.filter { it.isNotBlank() }.toSet().ifEmpty { setOf("seg", "ter", "qua", "qui", "sex", "sab") }
            opensAt = next.opensAt.ifBlank { "10:00" }
            closesAt = next.closesAt.ifBlank { "19:00" }
            whatsappMessage = next.whatsappMessage
            error = null
        } catch (t: Throwable) {
            error = t.message ?: "Não foi possível carregar as configurações da loja."
        } finally {
            loading = false
        }
    }

    LaunchedEffect(Unit) { load() }

    if (loading) {
        Box(modifier = modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            CircularProgressIndicator(color = web.accent)
        }
        return
    }

    LazyColumn(
        modifier = modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = 12.dp, end = 12.dp, bottom = 28.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        item {
            Column {
                Text("OPERAÇÃO DA LOJA", color = web.accentDark, fontSize = 9.5.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = .5.sp)
                Text("Configurações públicas", color = web.text, fontSize = 18.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 4.dp))
                Text("Atualize atendimento, retirada, entregas, contato e imagens exibidos no site.", color = web.muted, fontSize = 11.5.sp, lineHeight = 16.sp, modifier = Modifier.padding(top = 4.dp))
            }
        }

        if (error != null) {
            item {
                Surface(modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(10.dp), color = web.accentSoft) {
                    Text(error.orEmpty(), color = web.danger, fontSize = 11.5.sp, modifier = Modifier.padding(12.dp))
                }
            }
        }

        if (status != null) {
            item {
                Surface(modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(10.dp), color = web.greenSoft) {
                    Text(status.orEmpty(), color = web.tagGreenText, fontSize = 11.5.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(12.dp))
                }
            }
        }

        item {
            StoreCard(title = "Atendimento", subtitle = "Dias e horário em que a R&P atende.", icon = "◷") {
                Row(modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                    storeDays.forEach { (key, label) ->
                        val active = key in activeDays
                        Surface(
                            onClick = {
                                activeDays = if (active) activeDays - key else activeDays + key
                                status = null
                            },
                            shape = RoundedCornerShape(8.dp),
                            color = if (active) web.accentSoft else web.surface,
                            border = BorderStroke(1.dp, if (active) web.accent else web.borderStrong)
                        ) {
                            Text(label, color = if (active) web.accentDark else web.muted, fontSize = 10.5.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(horizontal = 10.dp, vertical = 8.dp))
                        }
                    }
                }
                Spacer(Modifier.height(14.dp))
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    StoreInput("Abre", opensAt, { opensAt = it; status = null }, Modifier.weight(1f))
                    StoreInput("Fecha", closesAt, { closesAt = it; status = null }, Modifier.weight(1f))
                }
                Text(scheduleText(activeDays.toList(), opensAt, closesAt), color = web.muted, fontSize = 10.5.sp, modifier = Modifier.padding(top = 10.dp))
            }
        }

        item {
            StoreCard(title = "Contato", subtitle = "WhatsApp e mensagem padrão do site.", icon = "☎") {
                StoreInput("WhatsApp", whatsapp, { whatsapp = it; status = null })
                Spacer(Modifier.height(10.dp))
                StoreInput("Mensagem do WhatsApp", whatsappMessage, { whatsappMessage = it; status = null }, minHeight = 82)
            }
        }

        item {
            StoreCard(title = "Retirada", subtitle = "Endereço e ponto de retirada exibidos ao cliente.", icon = "⌂") {
                StoreInput("Local de retirada", pickupLocation, { pickupLocation = it; status = null })
                Spacer(Modifier.height(10.dp))
                StoreInput("Endereço", address, { address = it; status = null })
                Spacer(Modifier.height(10.dp))
                StoreInput("Link do Google Maps", mapsUrl, { mapsUrl = it; status = null })
            }
        }

        item {
            StoreCard(title = "Entregas", subtitle = "Status público das entregas.", icon = "↗") {
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    deliveryOptions.forEach { (key, label) ->
                        val active = deliveryStatus == key
                        Surface(
                            onClick = { deliveryStatus = key; status = null },
                            modifier = Modifier.weight(1f),
                            shape = RoundedCornerShape(9.dp),
                            color = if (active) web.accentSoft else web.surface,
                            border = BorderStroke(1.dp, if (active) web.accent else web.borderStrong)
                        ) {
                            Box(contentAlignment = Alignment.Center, modifier = Modifier.height(42.dp)) {
                                Text(label, color = if (active) web.accentDark else web.muted, fontSize = 9.5.sp, fontWeight = FontWeight.Bold)
                            }
                        }
                    }
                }
            }
        }

        item {
            StoreCard(title = "Aparência do site", subtitle = "Imagens usadas na página inicial.", icon = "▣") {
                SiteImagePreview("Imagem principal", config?.heroImageKey.orEmpty())
                HorizontalDivider(color = web.border, modifier = Modifier.padding(vertical = 14.dp))
                SiteImagePreview("Nossa história", config?.aboutImageKey.orEmpty())
            }
        }

        item {
            Surface(
                onClick = {
                    if (saving) return@Surface
                    saving = true
                    error = null
                    status = "Salvando…"
                    scope.launch {
                        val schedule = scheduleText(activeDays.toList(), opensAt, closesAt)
                        runCatching {
                            repository.update(
                                StoreUpdateInput(
                                    pickupLocation = pickupLocation.trim(),
                                    endereco = address.trim(),
                                    mapsUrl = mapsUrl.trim(),
                                    whatsapp = whatsapp.trim(),
                                    whatsappMessage = whatsappMessage.trim(),
                                    scheduleDays = storeDays.map { it.first }.filter { it in activeDays }.joinToString(","),
                                    opensAt = opensAt.ifBlank { "10:00" },
                                    closesAt = closesAt.ifBlank { "19:00" },
                                    scheduleText = schedule,
                                    deliveryStatus = deliveryStatus
                                )
                            )
                        }.onSuccess {
                            status = "Alterações salvas ✓"
                            load()
                        }.onFailure {
                            error = it.message ?: "Não foi possível salvar as alterações."
                            status = null
                        }
                        saving = false
                    }
                },
                modifier = Modifier.fillMaxWidth().height(44.dp),
                shape = RoundedCornerShape(10.dp),
                color = web.accent,
                border = BorderStroke(1.dp, web.accentDark)
            ) {
                Box(contentAlignment = Alignment.Center) {
                    if (saving) CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp, color = Color.White)
                    else Text("Salvar alterações", color = Color.White, fontSize = 11.5.sp, fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}

@Composable
private fun StoreCard(title: String, subtitle: String, icon: String, content: @Composable Column.() -> Unit) {
    val web = LocalRPWebColors.current
    Surface(modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(14.dp), color = web.surfaceVeilTwo, border = BorderStroke(1.dp, web.border)) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                Surface(modifier = Modifier.size(34.dp), shape = RoundedCornerShape(10.dp), color = web.accentSoft) {
                    Box(contentAlignment = Alignment.Center) { Text(icon, color = web.accentDark, fontSize = 15.sp, fontWeight = FontWeight.Bold) }
                }
                Column(modifier = Modifier.weight(1f)) {
                    Text(title, color = web.text, fontSize = 13.5.sp, fontWeight = FontWeight.Bold)
                    Text(subtitle, color = web.muted, fontSize = 10.5.sp, modifier = Modifier.padding(top = 2.dp))
                }
            }
            Spacer(Modifier.height(16.dp))
            content()
        }
    }
}

@Composable
private fun StoreInput(
    label: String,
    value: String,
    onChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    minHeight: Int = 42
) {
    val web = LocalRPWebColors.current
    Column(modifier = modifier) {
        Text(label, color = web.muted, fontSize = 10.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(5.dp))
        Surface(
            modifier = Modifier.fillMaxWidth().height(minHeight.dp),
            shape = RoundedCornerShape(9.dp),
            color = web.surface,
            border = BorderStroke(1.dp, web.borderStrong)
        ) {
            BasicTextField(
                value = value,
                onValueChange = onChange,
                singleLine = minHeight <= 48,
                textStyle = androidx.compose.ui.text.TextStyle(color = web.text, fontSize = 12.sp, lineHeight = 17.sp),
                modifier = Modifier.fillMaxSize().padding(horizontal = 12.dp, vertical = 11.dp)
            )
        }
    }
}

@Composable
private fun SiteImagePreview(title: String, key: String) {
    val web = LocalRPWebColors.current
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
        Surface(modifier = Modifier.width(92.dp).height(68.dp), shape = RoundedCornerShape(10.dp), color = web.graySoft, border = BorderStroke(1.dp, web.border)) {
            if (key.isNotBlank()) {
                AsyncImage(
                    model = BuildConfig.API_ORIGIN + "/api/images/" + Uri.encode(key),
                    contentDescription = title,
                    modifier = Modifier.fillMaxSize(),
                    contentScale = ContentScale.Crop
                )
            } else {
                Box(contentAlignment = Alignment.Center) { Text("Sem foto", color = web.muted, fontSize = 10.sp) }
            }
        }
        Column(modifier = Modifier.weight(1f)) {
            Text(title, color = web.text, fontSize = 12.sp, fontWeight = FontWeight.Bold)
            Text(if (key.isBlank()) "Nenhuma imagem cadastrada." else "Imagem cadastrada no site.", color = web.muted, fontSize = 10.5.sp, modifier = Modifier.padding(top = 3.dp))
            Text("JPG, PNG ou WebP · até 5 MB", color = web.muted, fontSize = 9.5.sp, modifier = Modifier.padding(top = 3.dp))
        }
    }
}

private fun scheduleText(days: List<String>, open: String, close: String): String {
    val indexes = storeDays.mapIndexedNotNull { index, pair -> index.takeIf { pair.first in days } }
    val dayText = if (indexes.isEmpty()) {
        "Nenhum dia selecionado"
    } else {
        val consecutive = indexes.zipWithNext().all { (a, b) -> b == a + 1 }
        if (consecutive && indexes.size > 2) {
            "${storeDays[indexes.first()].second} a ${storeDays[indexes.last()].second.lowercase()}"
        } else {
            indexes.joinToString(", ") { storeDays[it].second }
        }
    }
    return "$dayText, ${humanTime(open)} às ${humanTime(close)}"
}

private fun humanTime(value: String): String {
    val parts = value.split(":")
    val hour = parts.getOrNull(0)?.toIntOrNull() ?: 10
    val minute = parts.getOrNull(1) ?: "00"
    return if (minute == "00") "${hour}h" else "${hour}h$minute"
}
