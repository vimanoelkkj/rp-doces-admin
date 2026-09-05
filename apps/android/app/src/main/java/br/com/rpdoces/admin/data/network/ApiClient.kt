package br.com.rpdoces.admin.data.network

import br.com.rpdoces.admin.BuildConfig
import java.util.concurrent.TimeUnit
import kotlinx.serialization.json.Json
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory

class ApiClient(
    sessionCookieJar: SessionCookieJar
) {
    val json: Json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
        isLenient = true
    }

    private val originInterceptor = Interceptor { chain ->
        val request = chain.request()
        val method = request.method.uppercase()
        val needsOrigin = method != "GET" && method != "HEAD" && method != "OPTIONS"
        val next = if (needsOrigin) {
            request.newBuilder()
                .header("Origin", BuildConfig.API_ORIGIN)
                .header("Accept", "application/json")
                .build()
        } else {
            request.newBuilder()
                .header("Accept", "application/json")
                .build()
        }
        chain.proceed(next)
    }

    private val loggingInterceptor = HttpLoggingInterceptor().apply {
        level = if (BuildConfig.DEBUG) HttpLoggingInterceptor.Level.BASIC else HttpLoggingInterceptor.Level.NONE
        redactHeader("Cookie")
        redactHeader("Set-Cookie")
    }

    private val okHttp = OkHttpClient.Builder()
        .cookieJar(sessionCookieJar)
        .addInterceptor(originInterceptor)
        .addInterceptor(loggingInterceptor)
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .writeTimeout(20, TimeUnit.SECONDS)
        .build()

    val retrofit: Retrofit = Retrofit.Builder()
        .baseUrl(BuildConfig.API_BASE_URL)
        .client(okHttp)
        .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
        .build()
}
