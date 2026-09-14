import { Product } from "../types/product";

interface ProdutoApiRow {
  id: number;
  nome: string;
  categoria: string;
  descricao: string;
  preco_centavos: number;
  preco_promocional_centavos: number | null;
  promocao_inicio: string | null;
  promocao_fim: string | null;
  destaque: number;
  ordem: number;
  estoque: number;
  estoque_reservado: number;
  image_key: string | null;
}

function isPromoActive(row: ProdutoApiRow): boolean {
  if (row.preco_promocional_centavos == null) return false;
  const now = Date.now();
  if (row.promocao_inicio && now < Date.parse(row.promocao_inicio)) return false;
  if (row.promocao_fim && now > Date.parse(row.promocao_fim)) return false;
  return true;
}

// TODO: quando as imagens forem servidas via R2, trocar só esta função pela URL do endpoint de imagens.
function imageUrlFor(imageKey: string | null): string {
  return imageKey ? `/images/${imageKey}` : "";
}

function toProduct(row: ProdutoApiRow): Product {
  const centavos = isPromoActive(row)
    ? row.preco_promocional_centavos!
    : row.preco_centavos;

  return {
    id: row.id,
    name: row.nome,
    category: row.categoria,
    description: row.descricao || undefined,
    price: centavos / 100,
    image: imageUrlFor(row.image_key),
  };
}

export async function fetchProducts(): Promise<Product[]> {
  const response = await fetch("/api/produtos");
  if (!response.ok) {
    throw new Error(`Falha ao carregar produtos (${response.status})`);
  }
  const data = (await response.json()) as { produtos: ProdutoApiRow[] };
  return data.produtos.map(toProduct);
}
