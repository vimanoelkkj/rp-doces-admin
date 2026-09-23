export interface ItemWithAvailability {
  id: number;
  disponibilidade?: number;
}

export interface ReconcilableCartItem {
  id: number;
  name: string;
  price: number;
  image: string;
  quantity: number;
  disponibilidade?: number;
}

/**
 * Calcula a quantidade após tentar adicionar 1 unidade de um item,
 * respeitando a disponibilidade máxima conhecida.
 */
export function calculateAddQuantity(
  currentQuantity: number,
  disponibilidade?: number
): number {
  if (disponibilidade !== undefined) {
    if (disponibilidade <= 0) return currentQuantity;
    return Math.min(currentQuantity + 1, Math.max(0, disponibilidade));
  }
  return currentQuantity + 1;
}

/**
 * Calcula a quantidade após solicitação de alteração,
 * respeitando a disponibilidade máxima conhecida.
 */
export function calculateUpdateQuantity(
  requestedQuantity: number,
  disponibilidade?: number
): number {
  if (requestedQuantity <= 0) return 0;
  if (disponibilidade !== undefined) {
    if (disponibilidade <= 0) return 0;
    return Math.min(requestedQuantity, Math.max(0, disponibilidade));
  }
  return requestedQuantity;
}

/**
 * Reconcilia os itens do carrinho com a lista atualizada de produtos/disponibilidades.
 * - Remove itens cuja disponibilidade for 0.
 * - Limita a quantidade salva ao máximo de disponibilidade atual.
 * - Atualiza o campo `disponibilidade` de cada item no carrinho.
 */
export function reconcileCartWithCatalog<T extends ReconcilableCartItem>(
  cartItems: T[],
  catalog: ItemWithAvailability[]
): { reconciled: T[]; adjusted: boolean } {
  if (!catalog || catalog.length === 0) {
    return { reconciled: cartItems, adjusted: false };
  }

  const catalogMap = new Map<number, number>();
  for (const item of catalog) {
    if (typeof item.disponibilidade === "number") {
      catalogMap.set(item.id, Math.max(0, item.disponibilidade));
    }
  }

  let adjusted = false;
  const reconciled: T[] = [];

  for (const item of cartItems) {
    if (!catalogMap.has(item.id)) {
      // Produto não consta no catálogo ativo (pode estar inativo ou mantido com disponibilidade anterior)
      reconciled.push(item);
      continue;
    }

    const disp = catalogMap.get(item.id)!;

    if (disp <= 0) {
      // Sem estoque restante -> item removido do carrinho
      adjusted = true;
      continue;
    }

    if (item.quantity > disp) {
      // Quantidade no carrinho superior ao estoque restante -> reduz para o limite
      reconciled.push({
        ...item,
        quantity: disp,
        disponibilidade: disp,
      });
      adjusted = true;
    } else {
      const dispMudou = item.disponibilidade !== disp;
      reconciled.push({
        ...item,
        disponibilidade: disp,
      });
      if (dispMudou) {
        adjusted = true;
      }
    }
  }

  return { reconciled, adjusted };
}
