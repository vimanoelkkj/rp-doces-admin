package br.com.rpdoces.admin.ui.dashboard

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import br.com.rpdoces.admin.data.dashboard.DashboardRepository
import br.com.rpdoces.admin.data.dashboard.DashboardSnapshot
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

sealed interface DashboardUiState {
    data object Loading : DashboardUiState
    data class Ready(
        val snapshot: DashboardSnapshot,
        val refreshing: Boolean = false,
        val refreshError: String? = null
    ) : DashboardUiState
    data class Error(val message: String) : DashboardUiState
}

class DashboardViewModel(
    private val repository: DashboardRepository
) : ViewModel() {
    private val _state = MutableStateFlow<DashboardUiState>(DashboardUiState.Loading)
    val state: StateFlow<DashboardUiState> = _state.asStateFlow()

    init {
        refresh()
    }

    fun refresh() {
        val current = _state.value
        if (current is DashboardUiState.Ready && current.refreshing) return

        if (current is DashboardUiState.Ready) {
            _state.value = current.copy(refreshing = true, refreshError = null)
        } else {
            _state.value = DashboardUiState.Loading
        }

        viewModelScope.launch {
            _state.value = try {
                DashboardUiState.Ready(repository.load())
            } catch (error: Exception) {
                val message = error.message ?: "Não foi possível carregar o dashboard."
                val latest = _state.value
                if (latest is DashboardUiState.Ready) {
                    latest.copy(refreshing = false, refreshError = message)
                } else {
                    DashboardUiState.Error(message)
                }
            }
        }
    }

    companion object {
        fun factory(repository: DashboardRepository): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T {
                    return DashboardViewModel(repository) as T
                }
            }
    }
}
