package br.com.rpdoces.admin.ui.orders

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import br.com.rpdoces.admin.RPApplication
import br.com.rpdoces.admin.data.orders.OrdersRepository

@Composable
fun OrdersScreen(
    repository: OrdersRepository,
    modifier: Modifier = Modifier
) {
    val app = LocalContext.current.applicationContext as RPApplication
    OrdersScreen(
        repository = repository,
        productsRepository = app.container.productsRepository,
        modifier = modifier
    )
}
