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
  peso_texto?: string | null;
  ingredientes?: string | null;
  alergenicos?: string | null;
}

// Campos de texto opcionais: vazio (ou só espaços) vira undefined, para a UI
// não renderizar blocos vazios.
function textoOpcional(valor: string | null | undefined): string | undefined {
  const texto = typeof valor === "string" ? valor.trim() : "";
  return texto || undefined;
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

  const estoque = typeof row.estoque === "number" ? row.estoque : 0;
  const estoqueReservado = typeof row.estoque_reservado === "number" ? row.estoque_reservado : 0;
  const disponibilidade = Math.max(0, estoque - estoqueReservado);

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
    weightText: textoOpcional(row.peso_texto),
    ingredients: textoOpcional(row.ingredientes),
    allergens: textoOpcional(row.alergenicos),
    price: centavos / 100,
    originalPrice: emPromocao ? row.preco_centavos / 100 : undefined,
    image: imageUrlFor(row.image_key),
    disponibilidade,
  };
}

// Pede ao servidor que devolva ao estoque livre as reservas Pix já vencidas
// antes de ler o catálogo, para a vitrine não mostrar como esgotado um item
// preso por Pix abandonado. Best-effort: qualquer falha é ignorada e o
// catálogo carrega do mesmo jeito. A regra de expiração vive só no servidor.
async function liberarReservasVencidas(): Promise<void> {
  try {
    await fetch("/api/reservas/reconciliar", { method: "POST" });
  } catch {
    // ignora: o GET abaixo continua
  }
}

export async function fetchProducts(): Promise<Product[]> {
  await liberarReservasVencidas();
  const response = await fetch("/api/produtos");
  if (!response.ok) {
    throw new Error(`Falha ao carregar produtos (${response.status})`);
  }
  const data = (await response.json()) as { produtos: ProdutoApiRow[] };
  return data.produtos.map(toProduct);
}
