package br.com.rpdoces.admin.ui.dashboard

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.ChevronLeft
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import br.com.rpdoces.admin.ui.components.MotionDropdownMenu
import br.com.rpdoces.admin.ui.theme.LocalRPWebColors
import java.time.LocalDate
import java.time.YearMonth
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.util.Locale

private val calendarLocale = Locale("pt", "BR")
private val calendarDateFormat = DateTimeFormatter.ofPattern("dd/MM/yyyy", calendarLocale)
private val calendarMonthFormat = DateTimeFormatter.ofPattern("MMMM 'de' yyyy", calendarLocale)
private val weekdays = listOf("dom", "seg", "ter", "qua", "qui", "sex", "sáb")

/**
 * Calendário nativo que replica o seletor do Admin V2, sem abrir o DatePicker do Android.
 * Mantém domingo como primeira coluna, bloqueia datas futuras e não permite avançar
 * além do mês atual, igual ao dashboard web.
 */
@Composable
internal fun SiteDashboardDateSelector(
    selectedDate: LocalDate,
    today: LocalDate,
    onSelected: (LocalDate) -> Unit,
    modifier: Modifier = Modifier
) {
    val web = LocalRPWebColors.current
    var open by rememberSaveable { mutableStateOf(false) }
    var viewYear by rememberSaveable { mutableIntStateOf(selectedDate.year) }
    var viewMonth by rememberSaveable { mutableIntStateOf(selectedDate.monthValue) }

    fun openCalendar() {
        if (!open) {
            viewYear = selectedDate.year
            viewMonth = selectedDate.monthValue
        }
        open = !open
    }

    val view = remember(viewYear, viewMonth) { YearMonth.of(viewYear, viewMonth) }
    val current = remember(today) { YearMonth.from(today) }

    Box(modifier = modifier) {
        Surface(
            onClick = ::openCalendar,
            modifier = Modifier.width(116.dp).height(30.dp),
            shape = RoundedCornerShape(8.dp),
            color = web.surface,
            border = BorderStroke(1.dp, web.border)
        ) {
            Row(
                modifier = Modifier.fillMaxSize().padding(horizontal = 10.dp),
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(
                    Icons.Outlined.CalendarMonth,
                    contentDescription = null,
                    modifier = Modifier.size(15.dp),
                    tint = web.muted
                )
                Spacer(Modifier.width(7.dp))
                Text(
                    selectedDate.format(calendarDateFormat),
                    color = web.text,
                    fontSize = 11.5.sp,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1
                )
            }
        }

        MotionDropdownMenu(
            expanded = open,
            onDismissRequest = { open = false },
            modifier = Modifier.width(250.dp).background(web.surface)
        ) {
            Column(modifier = Modifier.width(250.dp).padding(12.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    CalendarHeaderButton(
                        icon = Icons.Outlined.ChevronLeft,
                        description = "Mês anterior",
                        enabled = true,
                        onClick = {
                            val previous = view.minusMonths(1)
                            viewYear = previous.year
                            viewMonth = previous.monthValue
                        }
                    )
                    Text(
                        text = monthLabel(view),
                        modifier = Modifier.weight(1f),
                        color = web.text,
                        fontSize = 11.5.sp,
                        fontWeight = FontWeight.Bold,
                        textAlign = androidx.compose.ui.text.style.TextAlign.Center
                    )
                    CalendarHeaderButton(
                        icon = Icons.Outlined.ChevronRight,
                        description = "Próximo mês",
                        enabled = view < current,
                        onClick = {
                            if (view < current) {
                                val next = view.plusMonths(1)
                                viewYear = next.year
                                viewMonth = next.monthValue
                            }
                        }
                    )
                }

                Spacer(Modifier.height(10.dp))

                Row(modifier = Modifier.fillMaxWidth()) {
                    weekdays.forEach { day ->
                        Box(modifier = Modifier.weight(1f), contentAlignment = Alignment.Center) {
                            Text(
                                day.uppercase(calendarLocale),
                                color = web.muted,
                                fontSize = 9.5.sp,
                                fontWeight = FontWeight.Bold
                            )
                        }
                    }
                }

                Spacer(Modifier.height(4.dp))

                calendarCells(view).chunked(7).forEach { week ->
                    Row(modifier = Modifier.fillMaxWidth()) {
                        week.forEach { date ->
                            val outside = date.monthValue != view.monthValue
                            val future = date.isAfter(today)
                            val selected = date == selectedDate
                            val isToday = date == today
                            val foreground = when {
                                selected -> Color.White
                                future -> web.muted.copy(alpha = .25f)
                                outside -> web.muted.copy(alpha = .5f)
                                else -> web.text
                            }
                            Surface(
                                onClick = {
                                    if (!future) {
                                        onSelected(date)
                                        open = false
                                    }
                                },
                                enabled = !future,
                                modifier = Modifier.weight(1f).height(30.dp).padding(1.dp),
                                shape = RoundedCornerShape(8.dp),
                                color = if (selected) web.accent else Color.Transparent,
                                border = if (isToday && !selected) BorderStroke(1.dp, web.accent) else null
                            ) {
                                Box(contentAlignment = Alignment.Center) {
                                    Text(
                                        date.dayOfMonth.toString(),
                                        color = foreground,
                                        fontSize = 11.5.sp,
                                        fontWeight = if (selected) FontWeight.Bold else FontWeight.Normal
                                    )
                                }
                            }
                        }
                    }
                }

                Surface(
                    onClick = {
                        onSelected(today)
                        open = false
                    },
                    modifier = Modifier.fillMaxWidth().padding(top = 10.dp).height(32.dp),
                    shape = RoundedCornerShape(8.dp),
                    color = web.surface,
                    border = BorderStroke(1.dp, web.borderStrong)
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Text("Limpar", color = web.muted, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
                    }
                }
            }
        }
    }
}

@Composable
private fun CalendarHeaderButton(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    description: String,
    enabled: Boolean,
    onClick: () -> Unit
) {
    val web = LocalRPWebColors.current
    Surface(
        onClick = onClick,
        enabled = enabled,
        modifier = Modifier.size(30.dp),
        shape = RoundedCornerShape(8.dp),
        color = Color.Transparent
    ) {
        Box(contentAlignment = Alignment.Center) {
            Icon(
                icon,
                contentDescription = description,
                tint = if (enabled) web.muted else web.muted.copy(alpha = .25f),
                modifier = Modifier.size(15.dp)
            )
        }
    }
}

private fun calendarCells(month: YearMonth): List<LocalDate> {
    val first = month.atDay(1)
    val sundayOffset = first.dayOfWeek.value % 7
    val start = first.minusDays(sundayOffset.toLong())
    return List(42) { index -> start.plusDays(index.toLong()) }
}

private fun monthLabel(month: YearMonth): String {
    val raw = month.atDay(1).format(calendarMonthFormat)
    return raw.replaceFirstChar { if (it.isLowerCase()) it.titlecase(calendarLocale) else it.toString() }
}

internal fun dashboardDayOffset(today: LocalDate, picked: LocalDate): Int =
    ChronoUnit.DAYS.between(today, picked.coerceAtMost(today)).toInt().coerceAtMost(0)
