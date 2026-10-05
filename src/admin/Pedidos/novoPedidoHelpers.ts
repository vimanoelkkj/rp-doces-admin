import type { ProdutoAdmin } from "../Produtos/AdminProdutos";

export interface OrderItem {
  // Estável por linha, nunca reaproveitado pelo índice do array: usado como
  // React key para o dropdown de cada linha (`useDropdown()`, estado local
  // `open`) não vazar para a linha errada quando um item do meio é removido.
  id: number;
  produtoId: number | null;
  quantidade: number;
}

let nextOrderItemId = 0;
export const newOrderItem = (): OrderItem => ({
  id: nextOrderItemId++,
  produtoId: null,
  quantidade: 1
});

export type MetodoPagamento = "DINHEIRO" | "CARTAO" | "PIX_EXTERNO" | "A_COMBINAR";
export type StatusPagamento = "PENDENTE" | "PAGO";

export const METODO_OPTIONS: { value: MetodoPagamento; label: string }[] = [
  { value: "DINHEIRO", label: "Dinheiro" },
  { value: "CARTAO", label: "Cartão" },
  { value: "PIX_EXTERNO", label: "Pix externo" },
  { value: "A_COMBINAR", label: "A combinar" }
];

export const STATUS_OPTIONS: { value: StatusPagamento; label: string }[] = [
  { value: "PENDENTE", label: "Aguardando pagamento" },
  { value: "PAGO", label: "Já pago" }
];

export const MAX_ITENS_PEDIDO_MANUAL = 20;

export const formatarPreco = (centavos: number) =>
  `R$ ${(centavos / 100).toFixed(2).replace(".", ",")}`;

export const estoqueLivre = (p: ProdutoAdmin) => Math.max(0, p.estoque - p.estoque_reservado);

export interface NovoPedidoModalProps {
  open: boolean;
  onClose: () => void;
  onCreated?: () => void;
}

export interface ProductItemRowProps {
  item: OrderItem;
  produtos: ProdutoAdmin[];
  onChangeProduct: (id: number | null) => void;
  onChangeQty: (qty: number) => void;
  onRemove: () => void;
  canRemove: boolean;
}

export interface NovoPedidoPagamentoSectionProps {
  fieldId: string;
  metodoPagamento: MetodoPagamento;
  statusPagamento: StatusPagamento;
  onSelectMetodo: (m: MetodoPagamento) => void;
  onSelectStatus: (s: StatusPagamento) => void;
}
