import { pedidoEncerrado } from "./ultimoPedido";

export type StatusPedido = "NOVO" | "PREPARANDO" | "PRONTO" | "ENTREGUE" | "CANCELADO";

export interface PedidoStatusResponse {
  statusPagamento: string;
  statusPedido: StatusPedido;
}

// Reembolsado ou cancelado depois da aprovação: a tela de confirmação deixou de valer e o
// acompanhamento mostra o estado real. Só a entrega normal (ENTREGUE e PAGO) continua nela ("Retirado").
export function confirmacaoEncerrada(pedido: PedidoStatusResponse): boolean {
  const entregaNormal = pedido.statusPedido === "ENTREGUE" && pedido.statusPagamento === "PAGO";
  return pedidoEncerrado(pedido) && !entregaNormal;
}

export type EstadoEtapa = "done" | "current" | "pending";

export interface EtapaDaLinhaDoTempo {
  id: string;
  rotulo: string;
  estado: EstadoEtapa;
}

// Pedido recebido e pagamento confirmado já aconteceram quando a tela aparece; preparo e retirada
// avançam com o status operacional.
export function etapasDaLinhaDoTempo(statusPedido: StatusPedido): EtapaDaLinhaDoTempo[] {
  const pronto = statusPedido === "PRONTO";
  const entregue = statusPedido === "ENTREGUE";
  return [
    { id: "recebido", rotulo: "Pedido recebido", estado: "done" },
    { id: "pagamento", rotulo: "Pagamento confirmado", estado: "done" },
    { id: "preparo", rotulo: "Em preparação", estado: pronto || entregue ? "done" : "current" },
    {
      id: "retirada",
      rotulo: entregue ? "Retirado" : "Pronto para retirada",
      estado: entregue ? "done" : pronto ? "current" : "pending"
    }
  ];
}
