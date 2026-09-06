package br.com.rpdoces.admin.data.products

import br.com.rpdoces.admin.data.dashboard.FlexibleBooleanSerializer
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.toRequestBody
import retrofit2.Response
import retrofit2.Retrofit
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.Multipart
import retrofit2.http.POST
import retrofit2.http.PUT
import retrofit2.http.Part
import retrofit2.http.Path
import retrofit2.http.Query

@Serializable
data class Product(
    val id: Int,
    val nome: String,
    val categoria: String,
    @SerialName("categoria_nome") val categoryName: String? = null,
    @SerialName("categoria_emoji") val categoryEmoji: String? = null,
    val descricao: String = "",
    @SerialName("preco_centavos") val priceCents: Int = 0,
    @Serializable(with = FlexibleBooleanSerializer::class)
    val disponivel: Boolean = true,
    @Serializable(with = FlexibleBooleanSerializer::class)
    val ativo: Boolean = true,
    @Serializable(with = FlexibleBooleanSerializer::class)
    val destaque: Boolean = false,
    val ordem: Int = 0,
    val emoji: String? = null,
    val estoque: Int = 0,
    @SerialName("estoque_reservado") val reservedStock: Int = 0,
    @SerialName("promocao_ativa")
    @Serializable(with = FlexibleBooleanSerializer::class)
    val promotionActive: Boolean = false,
    @SerialName("preco_promocional_centavos") val promotionalPriceCents: Int? = null,
    @SerialName("promocao_inicio") val promotionStart: String? = null,
    @SerialName("promocao_fim") val promotionEnd: String? = null,
    @SerialName("image_key") val imageKey: String? = null
) {
    val availableStock: Int get() = (estoque - reservedStock).coerceAtLeast(0)
    val currentPriceCents: Int get() = promotionalPriceCents?.takeIf { promotionActive && it > 0 } ?: priceCents
}

@Serializable
data class Category(
    val id: String,
    val nome: String,
    val emoji: String = "",
    val descricao: String? = null,
    val ordem: Int = 0,
    @Serializable(with = FlexibleBooleanSerializer::class)
    val ativo: Boolean = true,
    @Serializable(with = FlexibleBooleanSerializer::class)
    val sistema: Boolean = false,
    val produtos: Int = 0,
    val ativos: Int = 0,
    val arquivados: Int = 0
)

@Serializable
private data class ProductsResponse(val produtos: List<Product> = emptyList())

@Serializable
private data class CategoriesResponse(val categorias: List<Category> = emptyList())

@Serializable
data class ProductInput(
    val nome: String,
    val categoria: String,
    val descricao: String,
    @SerialName("preco_centavos") val priceCents: Int,
    val disponivel: Boolean,
    val ativo: Boolean,
    val destaque: Boolean,
    val emoji: String,
    val estoque: Int,
    @SerialName("promocao_ativa") val promotionActive: Boolean,
    @SerialName("preco_promocional_centavos") val promotionalPriceCents: Int? = null,
    @SerialName("promocao_inicio") val promotionStart: String? = null,
    @SerialName("promocao_fim") val promotionEnd: String? = null
)

@Serializable
data class CategoryInput(
    val nome: String,
    val emoji: String,
    val descricao: String
)

@Serializable
private data class CreateProductResponse(val ok: Boolean = false, val id: Int = 0)

@Serializable
private data class CreateCategoryResponse(val ok: Boolean = false, val id: String = "")

@Serializable
data class ImageUploadResult(
    val ok: Boolean = false,
    @SerialName("image_key") val imageKey: String = "",
    @SerialName("image_url") val imageUrl: String = ""
)

private interface ProductsApi {
    @GET("api/admin/products")
    suspend fun list(): Response<ProductsResponse>

    @GET("api/admin/categories")
    suspend fun categories(): Response<CategoriesResponse>

    @POST("api/admin/categories")
    suspend fun createCategory(@Body input: CategoryInput): Response<CreateCategoryResponse>

    @POST("api/admin/products")
    suspend fun create(@Body input: ProductInput): Response<CreateProductResponse>

    @PUT("api/admin/products/{id}")
    suspend fun update(@Path("id") id: Int, @Body input: ProductInput): Response<JsonElement>

    @DELETE("api/admin/products/{id}")
    suspend fun delete(@Path("id") id: Int, @Query("permanent") permanent: Int? = null): Response<JsonElement>

    @Multipart
    @POST("api/admin/products/{id}/image")
    suspend fun uploadImage(@Path("id") id: Int, @Part image: MultipartBody.Part): Response<ImageUploadResult>

    @DELETE("api/admin/products/{id}/image")
    suspend fun deleteImage(@Path("id") id: Int): Response<JsonElement>
}

class ProductsRepository(retrofit: Retrofit) {
    private val api = retrofit.create(ProductsApi::class.java)

    suspend fun list(): List<Product> = api.list().requireBody("Não foi possível carregar os produtos.").produtos

    suspend fun categories(): List<Category> = api.categories()
        .requireBody("Não foi possível carregar as categorias.")
        .categorias

    suspend fun activeCategories(): List<Category> = categories().filter { it.ativo }

    suspend fun createCategory(input: CategoryInput): String = api.createCategory(input)
        .requireBody("Não foi possível criar a categoria.")
        .id

    suspend fun create(input: ProductInput): Int = api.create(input)
        .requireBody("Não foi possível criar o produto.")
        .id

    suspend fun update(id: Int, input: ProductInput) {
        api.update(id, input).requireSuccess("Não foi possível atualizar o produto.")
    }

    suspend fun archive(id: Int) {
        api.delete(id).requireSuccess("Não foi possível arquivar o produto.")
    }

    suspend fun deletePermanently(id: Int) {
        api.delete(id, 1).requireSuccess("Não foi possível excluir o produto.")
    }

    suspend fun uploadImage(id: Int, bytes: ByteArray, fileName: String, mimeType: String): ImageUploadResult {
        val body = bytes.toRequestBody(mimeType.toMediaTypeOrNull())
        val part = MultipartBody.Part.createFormData("image", fileName, body)
        return api.uploadImage(id, part).requireBody("Não foi possível enviar a imagem.")
    }

    suspend fun deleteImage(id: Int) {
        api.deleteImage(id).requireSuccess("Não foi possível remover a imagem.")
    }

    suspend fun restore(product: Product) {
        update(
            product.id,
            ProductInput(
                nome = product.nome,
                categoria = product.categoria,
                descricao = product.descricao,
                priceCents = product.priceCents,
                disponivel = true,
                ativo = true,
                destaque = product.destaque,
                emoji = product.emoji.orEmpty(),
                estoque = product.estoque,
                promotionActive = product.promotionActive,
                promotionalPriceCents = product.promotionalPriceCents,
                promotionStart = product.promotionStart,
                promotionEnd = product.promotionEnd
            )
        )
    }
}

private fun <T> Response<T>.requireBody(message: String): T {
    if (!isSuccessful) throw ProductsException(message, code())
    return body() ?: throw ProductsException(message, code())
}

private fun Response<*>.requireSuccess(message: String) {
    if (!isSuccessful) throw ProductsException(message, code())
}

class ProductsException(message: String, val status: Int? = null) : Exception(message)
