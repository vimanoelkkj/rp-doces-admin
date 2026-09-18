import { Product } from "../types/product";
import { promocaoVigente, type PromocaoCampos } from "../../shared/promocao";

interface ProdutoApiRow extends PromocaoCampos {
  id: number;
  nome: string;
  categoria: string;
  categoria_nome: string;
  descricao: string;
  destaque: number;
  ordem: number;
  estoque: number;
  estoque_reservado: number;
  image_key: string | null;
}

// As imagens públicas são servidas pela Pages Function em /api/images/:key.
function imageUrlFor(imageKey: string | null): string {
  return imageKey ? `/api/images/${encodeURIComponent(imageKey)}` : "";
}

function toProduct(row: ProdutoApiRow): Product {
  // HUMAN-12: mesma regra do backend (`shared/promocao.ts`). `price` continua
  // sendo o preço a cobrar agora; `originalPrice` só existe quando há
  // promoção vigente, e serve apenas para o card mostrar o valor riscado.
  // Nada disso é enviado ao checkout — o servidor recalcula.
  const emPromocao = promocaoVigente(row);
  const centavos = emPromocao
    ? row.preco_promocional_centavos!
    : row.preco_centavos;

  return {
    id: row.id,
    name: row.nome,
    category: row.categoria_nome,
    // `row.categoria` é o id/slug canônico (`categorias.id`), já retornado
    // pela API pública e antes descartado aqui — só o nome de exibição
    // chegava ao frontend. Nenhuma mudança de backend foi necessária: o
    // campo já existia na resposta.
    categorySlug: row.categoria,
    description: row.descricao || undefined,
    price: centavos / 100,
    originalPrice: emPromocao ? row.preco_centavos / 100 : undefined,
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
