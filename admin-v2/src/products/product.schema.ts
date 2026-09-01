import { z } from "zod";

const sqliteBoolean = z
  .union([z.literal(0), z.literal(1), z.boolean()])
  .transform((value) => value === 1 || value === true);

export const ProductSchema = z.object({
  id: z.number().int().positive(),
  nome: z.string().min(1),
  categoria: z.string().min(1),
  categoria_nome: z.string().nullable(),
  categoria_emoji: z.string().nullable(),
  categoria_ordem: z.number().int().nullable().optional(),
  descricao: z.string(),
  preco_centavos: z.number().int().nonnegative(),
  disponivel: sqliteBoolean,
  ativo: sqliteBoolean,
  destaque: sqliteBoolean,
  ordem: z.number().int(),
  emoji: z.string().nullable(),
  estoque: z.number().int().nonnegative(),
  estoque_reservado: z.number().int().nonnegative(),
  promocao_ativa: sqliteBoolean,
  preco_promocional_centavos: z.number().int().nonnegative().nullable(),
  promocao_inicio: z.string().nullable(),
  promocao_fim: z.string().nullable(),
  image_key: z.string().nullable(),
  criado_em: z.string(),
  atualizado_em: z.string()
});

export const ProductsResponseSchema = z.object({ produtos: z.array(ProductSchema) });

export const ProductInputSchema = z.object({
  nome: z.string().trim().min(1, "Nome é obrigatório").max(100),
  categoria: z.string().min(1, "Categoria é obrigatória"),
  descricao: z.string().max(500),
  preco_centavos: z.number().int().positive("Preço deve ser maior que zero"),
  disponivel: z.boolean(),
  ativo: z.boolean(),
  destaque: z.boolean(),
  emoji: z.string().nullable(),
  estoque: z.number().int().min(0).max(100000),
  promocao_ativa: z.boolean(),
  preco_promocional_centavos: z.number().int().nonnegative().nullable(),
  promocao_inicio: z.string().nullable(),
  promocao_fim: z.string().nullable()
});

export const CategorySchema = z.object({
  id: z.string(),
  nome: z.string(),
  emoji: z.string(),
  ativo: sqliteBoolean
});
export const CategoriesResponseSchema = z.object({ categorias: z.array(CategorySchema) });

export const CreateProductResponseSchema = z.object({ ok: z.literal(true), id: z.number().int().positive() });
export const ImageUploadResponseSchema = z.object({ ok: z.literal(true), image_key: z.string(), image_url: z.string() });
export const ApiErrorSchema = z.object({ erro: z.string() });
