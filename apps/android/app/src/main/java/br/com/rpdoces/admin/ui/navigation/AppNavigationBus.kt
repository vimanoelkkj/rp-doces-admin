package br.com.rpdoces.admin.ui.navigation

import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.receiveAsFlow

sealed interface AppNavigationRequest {
    data class OpenProducts(val productIds: Set<Int>) : AppNavigationRequest
}

object AppNavigationBus {
    // Eventos efêmeros: o foco é consumido ao abrir Produtos para não reaparecer ao recriar a tela.
    private val channel = Channel<AppNavigationRequest>(Channel.BUFFERED)
    val requests = channel.receiveAsFlow()

    fun openProducts(productIds: Collection<Int>) {
        val ids = productIds.filter { it > 0 }.toSet()
        if (ids.isEmpty()) return
        channel.trySend(AppNavigationRequest.OpenProducts(ids))
    }
}
