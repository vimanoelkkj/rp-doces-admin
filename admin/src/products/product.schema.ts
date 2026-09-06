import { z } from "zod";
import { sqliteBoolean } from "../shared/sqliteTypes";

const categoryId = z
  .string()
  .trim()
  .min(1, "Categoria é obrigatória")
  .regex(/^[A-Z0-9][A-Z0-9_]{1,47}$/i, "Categoria inválida");

const productEmoji = z
  .string()
  .refine(value => [...value].length <= 16, "Emoji deve ter no máximo 16 caracteres");

const optionalDate = z
  .string()
  .nullable()
  .refine(value => value === null || Number.isFinite(Date.parse(value)), "Data inválida");

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

export const ProductInputSchema = z
  .object({
    nome: z.string().trim().min(1, "Nome é obrigatório").max(100),
    categoria: categoryId,
    descricao: z.string().trim().max(500),
    preco_centavos: z
      .number()
      .int()
      .min(1, "Preço deve ser maior que zero")
      .max(10_000_000, "Preço excede o limite permitido"),
    disponivel: z.boolean(),
    ativo: z.boolean(),
    destaque: z.boolean(),
    emoji: productEmoji,
    estoque: z.number().int().min(0).max(100000),
    promocao_ativa: z.boolean(),
    preco_promocional_centavos: z.number().int().min(1).nullable(),
    promocao_inicio: optionalDate,
    promocao_fim: optionalDate
  })
  .superRefine((product, ctx) => {
    const promotionalPrice = product.preco_promocional_centavos;

    if (product.promocao_ativa && promotionalPrice === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["preco_promocional_centavos"],
        message: "Informe o preço promocional"
      });
    }

    if (promotionalPrice !== null && promotionalPrice >= product.preco_centavos) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["preco_promocional_centavos"],
        message: "Preço promocional deve ser menor que o preço normal"
      });
    }

    if (
      product.promocao_inicio &&
      product.promocao_fim &&
      Date.parse(product.promocao_fim) <= Date.parse(product.promocao_inicio)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["promocao_fim"],
        message: "Fim da promoção deve ser posterior ao início"
      });
    }
  });

export const CategorySchema = z.object({
  id: z.string(),
  nome: z.string(),
  emoji: z.string(),
  descricao: z.string().nullable().optional(),
  ordem: z.number().int().optional(),
  ativo: sqliteBoolean,
  sistema: sqliteBoolean.optional(),
  produtos: z.number().int().nonnegative().optional(),
  ativos: z.number().int().nonnegative().optional(),
  arquivados: z.number().int().nonnegative().optional()
});
export const CategoriesResponseSchema = z.object({ categorias: z.array(CategorySchema) });
export const CreateCategoryResponseSchema = z.object({
  ok: z.literal(true),
  id: z.string()
});

export const CreateProductResponseSchema = z.object({
  ok: z.literal(true),
  id: z.number().int().positive()
});
export const ImageUploadResponseSchema = z.object({
  ok: z.literal(true),
  image_key: z.string(),
  image_url: z.string()
});
export const ApiErrorSchema = z.object({ erro: z.string() });
