package br.com.rpdoces.admin.data.network

import android.content.Context
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl

private const val SESSION_COOKIE = "rp_admin_session"
private const val SESSION_HOST = "rp-doces.pages.dev"
private const val KEY_ALIAS = "rp_admin_session_key"
private const val PREFS = "rp_admin_session_store"
private const val PREF_CIPHER = "ciphertext"
private const val PREF_IV = "iv"
private const val PREF_EXPIRES = "expires_at"

class SessionCookieJar(context: Context) : CookieJar {
    private val store = EncryptedSessionStore(context.applicationContext)

    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        val session = cookies.firstOrNull { it.name == SESSION_COOKIE } ?: return
        if (session.value.isBlank() || session.expiresAt <= System.currentTimeMillis()) {
            store.clear()
            return
        }
        store.write(session.value, session.expiresAt)
    }

    override fun loadForRequest(url: HttpUrl): List<Cookie> {
        if (url.host != SESSION_HOST) return emptyList()
        val saved = store.read() ?: return emptyList()
        if (saved.expiresAt <= System.currentTimeMillis()) {
            store.clear()
            return emptyList()
        }

        return listOf(
            Cookie.Builder()
                .name(SESSION_COOKIE)
                .value(saved.value)
                .hostOnlyDomain(SESSION_HOST)
                .path("/")
                .secure()
                .httpOnly()
                .expiresAt(saved.expiresAt)
                .build()
        )
    }

    fun clear() = store.clear()
}

private data class StoredSession(val value: String, val expiresAt: Long)

private class EncryptedSessionStore(context: Context) {
    private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun write(value: String, expiresAt: Long) {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, secretKey())
        val encrypted = cipher.doFinal(value.toByteArray(Charsets.UTF_8))

        prefs.edit()
            .putString(PREF_CIPHER, Base64.encodeToString(encrypted, Base64.NO_WRAP))
            .putString(PREF_IV, Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
            .putLong(PREF_EXPIRES, expiresAt)
            .apply()
    }

    fun read(): StoredSession? {
        val encryptedText = prefs.getString(PREF_CIPHER, null) ?: return null
        val ivText = prefs.getString(PREF_IV, null) ?: return null
        val expiresAt = prefs.getLong(PREF_EXPIRES, 0L)

        return try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(
                Cipher.DECRYPT_MODE,
                secretKey(),
                GCMParameterSpec(128, Base64.decode(ivText, Base64.NO_WRAP))
            )
            val decrypted = cipher.doFinal(Base64.decode(encryptedText, Base64.NO_WRAP))
            StoredSession(String(decrypted, Charsets.UTF_8), expiresAt)
        } catch (_: Exception) {
            clear()
            null
        }
    }

    fun clear() {
        prefs.edit().clear().apply()
    }

    private fun secretKey(): SecretKey {
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (keyStore.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }

        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        )
        return generator.generateKey()
    }
}
