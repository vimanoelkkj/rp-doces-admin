import { describe, expect, it } from "vitest";
import { sqliteBoolean } from "../shared/sqliteTypes";
import { CategorySchema, ProductInputSchema, ProductSchema } from "./product.schema";

describe("sqliteBoolean", () => {
  it.each([
    [1, true],
    [0, false],
    [true, true],
    [false, false]
  ])("converte %s para %s", (input, expected) => {
    expect(sqliteBoolean.parse(input)).toBe(expected);
  });

  it("rejeita valores fora do contrato sqlite", () => {
    expect(() => sqliteBoolean.parse(2)).toThrow();
    expect(() => sqliteBoolean.parse("1")).toThrow();
  });
});

describe("CategorySchema", () => {
  it("normaliza o campo ativo vindo do sqlite", () => {
    const category = CategorySchema.parse({
      id: "pudins",
      nome: "Pudins",
      emoji: "🍮",
      ativo: 1
    });

    expect(category.ativo).toBe(true);
  });
});

describe("ProductSchema", () => {
  const validProduct = {
    id: 1,
    nome: "Pudim tradicional",
    categoria: "pudins",
    categoria_nome: "Pudins",
    categoria_emoji: "🍮",
    categoria_ordem: 1,
    descricao: "Pudim artesanal",
    preco_centavos: 2500,
    disponivel: 1,
    ativo: 1,
    destaque: 0,
    ordem: 1,
    emoji: "🍮",
    estoque: 10,
    estoque_reservado: 2,
    promocao_ativa: 0,
    preco_promocional_centavos: null,
    promocao_inicio: null,
    promocao_fim: null,
    image_key: null,
    criado_em: "2026-08-31T00:00:00.000Z",
    atualizado_em: "2026-08-31T00:00:00.000Z"
  };

  it("aceita o formato atual da API e normaliza booleanos", () => {
    const product = ProductSchema.parse(validProduct);

    expect(product.disponivel).toBe(true);
    expect(product.ativo).toBe(true);
    expect(product.destaque).toBe(false);
    expect(product.promocao_ativa).toBe(false);
  });

  it("rejeita estoque negativo", () => {
    expect(() => ProductSchema.parse({ ...validProduct, estoque: -1 })).toThrow();
  });
});

describe("ProductInputSchema", () => {
  const validInput = {
    nome: "Pudim tradicional",
    categoria: "pudins",
    descricao: "Pudim artesanal",
    preco_centavos: 2500,
    disponivel: true,
    ativo: true,
    destaque: false,
    emoji: "🍮",
    estoque: 10,
    promocao_ativa: false,
    preco_promocional_centavos: null,
    promocao_inicio: null,
    promocao_fim: null
  };

  it("remove espaços extras do nome", () => {
    const product = ProductInputSchema.parse({ ...validInput, nome: "  Pudim  " });
    expect(product.nome).toBe("Pudim");
  });

  it("exige preço maior que zero", () => {
    const result = ProductInputSchema.safeParse({ ...validInput, preco_centavos: 0 });
    expect(result.success).toBe(false);
  });

  it("exige categoria", () => {
    const result = ProductInputSchema.safeParse({ ...validInput, categoria: "" });
    expect(result.success).toBe(false);
  });

  it("limita estoque a 100000", () => {
    const result = ProductInputSchema.safeParse({ ...validInput, estoque: 100001 });
    expect(result.success).toBe(false);
  });
});
