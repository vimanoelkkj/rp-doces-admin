import type { z } from "zod";
import type { ProductSchema, ProductInputSchema, ImageUploadResponseSchema } from "./product.schema";

export type Product = z.infer<typeof ProductSchema>;
export type ProductInput = z.infer<typeof ProductInputSchema>;
export type ProductId = Product["id"];
export type ImageUploadResult = z.infer<typeof ImageUploadResponseSchema>;
