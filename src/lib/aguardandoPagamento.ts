import type { CartItem } from "../context/CartContext";

export interface CheckoutState {
  items: CartItem[];
  cliente: { nome: string; whatsapp: string };
  recado?: string;
  operationKey?: string;
}

export interface CheckoutResponse {
  pedidoId: number;
  tokenPublico: string;
  paymentId: number;
  status: string;
  qrCode: string | null;
  qrCodeBase64: string | null;
  ticketUrl: string | null;
  expiresAt: string | null;
  totalCentavos: number;
}

export interface PedidoStatusResponse {
  pedidoId: number;
  statusPagamento: "PENDENTE" | "PAGO" | "CANCELADO" | "EXPIRADO" | "REEMBOLSADO" | "FALHOU";
  statusPedido: string;
}

export const POLL_INTERVAL_MS = 4000;

// A criação do Pix é uma única chamada de rede — não existem "3 etapas"
// reais de backend. Essa progressão de 2 passos (carrinho → gerando
// pagamento) é puramente estética: durações mínimas garantem que o cliente
// perceba as duas telas mesmo quando a rede responde quase instantaneamente,
// sem inventar uma 3ª etapa fake no lugar do QR Code real (que precisa
// aparecer assim que estiver pronto para o cliente pagar). Cada visita sorteia
// uma duração diferente dentro da faixa — não é uma barra de progresso com
// passos previsíveis, é só a percepção de "algo está acontecendo".
const LOADING_STEP_MIN_MS = 1500;
const LOADING_STEP_MAX_MS = 2500;
export const duracaoAleatoria = () =>
  LOADING_STEP_MIN_MS + Math.random() * (LOADING_STEP_MAX_MS - LOADING_STEP_MIN_MS);

export interface CorpoDeErroDoCheckout {
  code?: string;
  error?: string;
  tokenPublico?: unknown;
}

export type FalhaDoCheckout =
  | { tipo: "ACOMPANHAR"; tokenPublico: string }
  | { tipo: "ERRO"; mensagem: string; estoque: boolean };

// O que fazer com uma resposta de erro do checkout.
export function classificarFalhaCheckout(
  status: number,
  body: CorpoDeErroDoCheckout
): FalhaDoCheckout {
  // A1: a operação já foi iniciada e o resultado remoto ainda não é
  // conhecido (retry que encontrou a operação em andamento, ou o
  // primeiro envio com resultado ambíguo). O pedido JÁ existe —
  // nunca disparar outro checkout (isso criaria outro pedido, outra
  // reserva e outra cobrança). Segue para o acompanhamento dele.
  const acompanhavel =
    body.code === "OPERACAO_EM_PROCESSAMENTO" || body.code === "MERCADO_PAGO_INDISPONIVEL";
  if (acompanhavel && typeof body.tokenPublico === "string" && body.tokenPublico) {
    return { tipo: "ACOMPANHAR", tokenPublico: body.tokenPublico };
  }

  const estoque =
    status === 409 && (body.code === "ESTOQUE_INSUFICIENTE" || /estoque/i.test(body.error || ""));
  const mensagem = estoque
    ? body.error ||
      "O estoque de um ou mais itens selecionados não está mais disponível. Por favor, revise seu carrinho."
    : body.error || "Falha ao criar pagamento Pix";
  return { tipo: "ERRO", mensagem, estoque };
}

const STATUS_TERMINAIS = ["PAGO", "CANCELADO", "FALHOU", "REEMBOLSADO"];

// Estados de pagamento que encerram a espera do Pix e levam a outra tela.
export const statusTerminal = (statusPagamento: string): boolean =>
  STATUS_TERMINAIS.includes(statusPagamento);

export interface DestinoDoResultado {
  limparCarrinho: boolean;
  para: string;
  opcoes: { state?: unknown; replace?: boolean };
}

// Para onde a tela segue quando o pagamento chega a um estado terminal.
export function destinoDoResultado(
  resultado: string,
  payment: Pick<CheckoutResponse, "pedidoId" | "tokenPublico" | "totalCentavos">,
  items: CartItem[]
): DestinoDoResultado {
  if (resultado === "PAGO") {
    return {
      limparCarrinho: true,
      para: "/pedido-confirmado",
      opcoes: {
        state: {
          pedidoId: payment.pedidoId,
          tokenPublico: payment.tokenPublico,
          items,
          totalCentavos: payment.totalCentavos
        }
      }
    };
  }
  if (resultado === "REEMBOLSADO") {
    // Estornado (p.ex. ao voltar a esta tela depois de pagar): não há o que pagar; o
    // acompanhamento mostra o estado real.
    return {
      limparCarrinho: false,
      para: `/pedido/${encodeURIComponent(payment.tokenPublico)}`,
      opcoes: { replace: true }
    };
  }
  return {
    limparCarrinho: false,
    para: "/pagamento-nao-aprovado",
    opcoes: { state: { items, totalCentavos: payment.totalCentavos } }
  };
}

// Segundos até `expiresAt`, arredondados para baixo e nunca negativos.
export const segundosRestantes = (expiresAt: string, agora: number = Date.now()): number =>
  Math.max(0, Math.floor((Date.parse(expiresAt) - agora) / 1000));

// mm:ss do contador do Pix; sem prazo conhecido mostra "--".
export function formatarContagem(timeLeft: number | null): { minutes: string; seconds: string } {
  return {
    minutes:
      timeLeft != null
        ? Math.floor(timeLeft / 60)
            .toString()
            .padStart(2, "0")
        : "--",
    seconds: timeLeft != null ? (timeLeft % 60).toString().padStart(2, "0") : "--"
  };
}
