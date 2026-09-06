package br.com.rpdoces.admin.ui.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import br.com.rpdoces.admin.data.auth.AuthRepository
import br.com.rpdoces.admin.data.auth.AuthUser
import br.com.rpdoces.admin.data.auth.IdentifiedUser
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

sealed interface AuthUiState {
    data object Loading : AuthUiState
    data class SignedOut(
        val submitting: Boolean = false,
        val error: String? = null,
        val identifiedUser: IdentifiedUser? = null
    ) : AuthUiState
    data class SignedIn(
        val user: AuthUser,
        val restored: Boolean = false
    ) : AuthUiState
}

class AuthViewModel(
    private val repository: AuthRepository
) : ViewModel() {
    private val _state = MutableStateFlow<AuthUiState>(AuthUiState.Loading)
    val state: StateFlow<AuthUiState> = _state.asStateFlow()

    init {
        restoreSession()
    }

    private fun restoreSession() {
        viewModelScope.launch {
            _state.value = try {
                repository.restoreSession()?.let { AuthUiState.SignedIn(it, restored = true) } ?: AuthUiState.SignedOut()
            } catch (error: Exception) {
                AuthUiState.SignedOut(error = error.message ?: "Não foi possível conectar ao servidor.")
            }
        }
    }

    fun identify(username: String) {
        val current = _state.value
        if (current is AuthUiState.SignedOut && current.submitting) return

        viewModelScope.launch {
            _state.value = AuthUiState.SignedOut(submitting = true)
            _state.value = try {
                val identified = repository.identify(username)
                if (identified == null) {
                    AuthUiState.SignedOut(error = "Não encontramos uma conta ativa com esse usuário.")
                } else {
                    AuthUiState.SignedOut(identifiedUser = identified)
                }
            } catch (error: Exception) {
                AuthUiState.SignedOut(error = error.message ?: "Não foi possível localizar a conta.")
            }
        }
    }

    fun switchUser() {
        _state.value = AuthUiState.SignedOut()
    }

    fun login(username: String, password: String) {
        val current = _state.value
        if (current is AuthUiState.SignedOut && current.submitting) return

        viewModelScope.launch {
            _state.value = AuthUiState.SignedOut(
                submitting = true,
                identifiedUser = (current as? AuthUiState.SignedOut)?.identifiedUser
            )
            _state.value = try {
                AuthUiState.SignedIn(repository.login(username, password), restored = false)
            } catch (error: Exception) {
                AuthUiState.SignedOut(
                    error = error.message ?: "Não foi possível entrar.",
                    identifiedUser = (current as? AuthUiState.SignedOut)?.identifiedUser
                )
            }
        }
    }

    fun logout() {
        viewModelScope.launch {
            runCatching { repository.logout() }
            _state.value = AuthUiState.SignedOut()
        }
    }

    companion object {
        fun factory(repository: AuthRepository): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T {
                    return AuthViewModel(repository) as T
                }
            }
    }
}
