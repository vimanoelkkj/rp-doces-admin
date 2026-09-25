// Gatilho explícito da recuperação da comanda (refund Mercado Pago parado,
// finalização de cancelamento/troca). Os GETs de estado são somente leitura,
// então a tela chama isto antes de lê-los. Best-effort: qualquer falha é
// ignorada e a leitura segue normalmente.
export async function reconciliarPedido(orderId: number | string): Promise<void> {
  try {
    await fetch(`/api/admin/pedidos/${orderId}/reconciliar`, { method: "POST" });
  } catch {
    // ignora: o GET seguinte continua
  }
}
