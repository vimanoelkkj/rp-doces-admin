import { ApiErrorSchema, CategoriesResponseSchema, CreateProductResponseSchema, ImageUploadResponseSchema, ProductsResponseSchema } from "./product.schema";
import type { Product, ProductId, ProductInput, ImageUploadResult } from "./product.types";
import type { z } from "zod";
import type { CategorySchema } from "./product.schema";

export type Category = z.infer<typeof CategorySchema>;

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

export async function listCategories(): Promise<Category[]> {
  const result = CategoriesResponseSchema.parse(await requestJson("/api/admin/categories"));
  return result.categorias.filter((category) => category.ativo);
}

export async function createProduct(input: ProductInput): Promise<ProductId> {
  return CreateProductResponseSchema.parse(await requestJson("/api/admin/products", { method: "POST", body: JSON.stringify(input) })).id;
}

export async function updateProduct(id: ProductId, input: ProductInput): Promise<void> {
  await requestJson(`/api/admin/products/${id}`, { method: "PUT", body: JSON.stringify(input) });
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
