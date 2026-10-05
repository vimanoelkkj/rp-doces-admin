import {
  type PushSubscriptionData,
  type VapidConfig,
  sendPushNotification
} from "@mmmike/web-push/send";

function formatarMoedaCentavos(centavos: number): string {
  const valor = (centavos / 100).toFixed(2).replace(".", ",");
  return `R$ ${valor}`;
}

export function criarPayloadPedidoPago(pedidoId: number, valorTotalCentavos: number) {
  return {
    title: "Novo pedido 🍰",
    body: `Pedido RP-${pedidoId} · ${formatarMoedaCentavos(valorTotalCentavos)}`,
    tag: `pedido-${pedidoId}`,
    url: `/admin/pedidos?pedido=${pedidoId}`,
    pedidoId
  };
}

export async function enviarPush(
  subscription: PushSubscriptionData,
  payload: ReturnType<typeof criarPayloadPedidoPago>,
  vapid: VapidConfig
): Promise<boolean> {
  return sendPushNotification(subscription, payload, vapid);
}
