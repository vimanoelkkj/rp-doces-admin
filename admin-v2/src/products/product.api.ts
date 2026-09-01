import {
  ApiErrorSchema,
  CategoriesResponseSchema,
  CreateCategoryResponseSchema,
  CreateProductResponseSchema,
  ImageUploadResponseSchema,
  ProductsResponseSchema
} from "./product.schema";
import type { Product, ProductId, ProductInput, ImageUploadResult } from "./product.types";
import type { z } from "zod";
import type { CategorySchema } from "./product.schema";

export type Category = z.infer<typeof CategorySchema>;
export type CategoryInput = {
  nome: string;
  emoji: string;
  descricao: string;
};

export class ProductApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "ProductApiError";
  }
}

async function parseErrorResponse(response: Response): Promise<string> {
  try {
    const parsed = ApiErrorSchema.safeParse(await response.json());
    if (parsed.success) return parsed.data.erro;
  } catch {}
  return `Erro ${response.status} ao comunicar com o servidor.`;
}

async function requestJson(input: RequestInfo, init?: RequestInit): Promise<unknown> {
  const response = await fetch(input, {
    ...init,
    credentials: "include",
    headers: {
      ...(init?.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
      ...init?.headers
    }
  });
  if (!response.ok) throw new ProductApiError(await parseErrorResponse(response), response.status);
  return response.json();
}

export async function listProducts(): Promise<Product[]> {
  return ProductsResponseSchema.parse(await requestJson("/api/admin/products")).produtos;
}

export async function listAllCategories(): Promise<Category[]> {
  return CategoriesResponseSchema.parse(await requestJson("/api/admin/categories")).categorias;
}

export async function listCategories(): Promise<Category[]> {
  return (await listAllCategories()).filter(category => category.ativo);
}

export async function createCategory(input: CategoryInput): Promise<string> {
  return CreateCategoryResponseSchema.parse(
    await requestJson("/api/admin/categories", {
      method: "POST",
      body: JSON.stringify(input)
    })
  ).id;
}

export async function createProduct(input: ProductInput): Promise<ProductId> {
  return CreateProductResponseSchema.parse(await requestJson("/api/admin/products", { method: "POST", body: JSON.stringify(input) })).id;
}

export async function updateProduct(id: ProductId, input: ProductInput): Promise<void> {
  await requestJson(`/api/admin/products/${id}`, { method: "PUT", body: JSON.stringify(input) });
}

export async function restoreProduct(product: Product): Promise<void> {
  await updateProduct(product.id, {
    nome: product.nome,
    categoria: product.categoria,
    descricao: product.descricao,
    preco_centavos: product.preco_centavos,
    disponivel: true,
    ativo: true,
    destaque: product.destaque,
    emoji: product.emoji ?? "",
    estoque: product.estoque,
    promocao_ativa: product.promocao_ativa,
    preco_promocional_centavos: product.preco_promocional_centavos,
    promocao_inicio: product.promocao_inicio,
    promocao_fim: product.promocao_fim
  });
}

export async function deleteProduct(id: ProductId, permanent = false): Promise<void> {
  await requestJson(`/api/admin/products/${id}${permanent ? "?permanent=1" : ""}`, { method: "DELETE" });
}

export async function uploadProductImage(id: ProductId, file: File): Promise<ImageUploadResult> {
  const form = new FormData();
  form.set("image", file);
  return ImageUploadResponseSchema.parse(await requestJson(`/api/admin/products/${id}/image`, { method: "POST", body: form }));
}

export async function deleteProductImage(id: ProductId): Promise<void> {
  await requestJson(`/api/admin/products/${id}/image`, { method: "DELETE" });
}
