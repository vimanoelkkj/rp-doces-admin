import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import Header from "../components/Header";
import Footer from "../components/Footer";
import { CartItem, useCart } from "../context/CartContext";
import {
  gravarOperationKey,
  lerOperationKey,
  novaOperationKey,
  SLOT_CHECKOUT,
} from "../lib/operationKey";
import cakeCartImage from "../assets/cake-cart-image.png";
import "./AguardandoPagamento.css";

interface CheckoutState {
  items: CartItem[];
  cliente: { nome: string; whatsapp: string };
  recado?: string;
  operationKey?: string;
}

interface CheckoutResponse {
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

interface PedidoStatusResponse {
  pedidoId: number;
  statusPagamento: "PENDENTE" | "PAGO" | "CANCELADO" | "EXPIRADO" | "REEMBOLSADO" | "FALHOU";
  statusPedido: string;
}

const POLL_INTERVAL_MS = 4000;

// A criação do Pix é uma única chamada de rede — não existem "3 etapas"
// reais de backend. Essa progressão de 2 passos (carrinho → gerando
// pagamento) é puramente estética: tempos mínimos garantem que o cliente
// perceba as duas telas mesmo quando a rede responde quase instantaneamente,
// sem inventar uma 3ª etapa fake no lugar do QR Code real (que precisa
// aparecer assim que estiver pronto para o cliente pagar).
const MIN_STEP_DURATION_MS = 1200;
const MIN_TOTAL_LOADING_MS = 2400;

// Aparece só depois que a confirmação do pagamento chega de verdade (via
// polling), como uma transição breve antes de navegar para o resultado —
// nunca substitui a tela do QR Code, que é a etapa real de espera do
// cliente. Sem barra de progresso: não é uma etapa fake com passos
// conhecidos, é só uma pausa perceptível pra não pular direto pro
// resultado no instante em que detectamos a mudança de status.
const PROCESSANDO_DELAY_MS = 1400;

type Status = "criando" | "pronto" | "processando" | "erro";
type LoadingStep = 1 | 2;

export default function AguardandoPagamento() {
  const location = useLocation();
  const navigate = useNavigate();
  const { clearCart } = useCart();
  const state = location.state as CheckoutState | null;

  // A1: a MESMA identidade durante todo o ciclo de vida desta finalização.
  // `useRef` a resolve UMA vez por montagem e o `sessionStorage` a preserva
  // entre remontagens, StrictMode e retry — assim uma resposta HTTP perdida,
  // um abort ou um remount não viram um segundo pedido. Prioridade:
  // navegação (criada no Checkout) > sessão > geração local de último
  // recurso (mantém a página funcional mesmo sem storage disponível).
  const operationKeyRef = useRef<string | null>(null);
  if (operationKeyRef.current === null) {
    const resolvida =
      state?.operationKey ?? lerOperationKey(SLOT_CHECKOUT) ?? novaOperationKey();
    gravarOperationKey(SLOT_CHECKOUT, resolvida);
    operationKeyRef.current = resolvida;
  }

  const [status, setStatus] = useState<Status>("criando");
  const [loadingStep, setLoadingStep] = useState<LoadingStep>(1);
  const [payment, setPayment] = useState<CheckoutResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [copied, setCopied] = useState(false);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [resultadoPendente, setResultadoPendente] = useState<string | null>(null);
  const [expiradoNoServidor, setExpiradoNoServidor] = useState(false);
  const prazoEncerrado = timeLeft === 0 || expiradoNoServidor;

  useEffect(() => {
    if (!state || state.items.length === 0) {
      navigate("/cardapio");
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    const startedAt = Date.now();

    const stepTimer = setTimeout(() => {
      if (!cancelled) setLoadingStep(2);
    }, MIN_STEP_DURATION_MS);

    fetch("/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        items: state.items.map((item) => ({
          id: item.id,
          quantity: item.quantity,
        })),
        cliente: state.cliente,
        recado: state.recado,
        // A1: mesma finalização, mesma key — em toda tentativa.
        operationKey: operationKeyRef.current,
      }),
    })
      .then(async (response) => {
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          // A1: a operação já foi iniciada e o resultado remoto ainda não é
          // conhecido. O pedido JÁ existe — nunca disparar outro checkout
          // (isso criaria outro pedido, outra reserva e outra cobrança).
          // Segue para a tela de acompanhamento que já existe.
          if (body.code === "OPERACAO_EM_PROCESSAMENTO" && body.tokenPublico) {
            if (!cancelled) {
              navigate(`/pedido/${encodeURIComponent(body.tokenPublico)}`);
            }
            return null;
          }
          throw new Error(body.error || "Falha ao criar pagamento Pix");
        }
        return response.json() as Promise<CheckoutResponse>;
      })
      .then((data) => {
        if (cancelled || !data) return;
        const elapsed = Date.now() - startedAt;
        const remaining = Math.max(0, MIN_TOTAL_LOADING_MS - elapsed);
        setTimeout(() => {
          if (cancelled) return;
          setPayment(data);
          setStatus("pronto");
        }, remaining);
      })
      .catch((err) => {
        if (controller.signal.aborted || cancelled) return;
        setErrorMessage(err.message);
        setStatus("erro");
      });

    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(stepTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!payment?.expiresAt) return;
    const update = () => {
      const diff = Math.max(
        0,
        Math.floor((Date.parse(payment.expiresAt!) - Date.now()) / 1000),
      );
      setTimeLeft(diff);
    };
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [payment?.expiresAt]);

  useEffect(() => {
    if (status !== "pronto" || !payment) return;

    let cancelled = false;
    let inFlight = false;
    const controller = new AbortController();

    const goToResult = (statusPagamento: string) => {
      if (cancelled) return;
      cancelled = true;
      // Não navega direto: mostra a etapa "processando" por um instante
      // perceptível antes de revelar o resultado.
      setResultadoPendente(statusPagamento);
      setStatus("processando");
    };

    const poll = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        const response = await fetch(
          `/api/pedido-status?token=${encodeURIComponent(payment.tokenPublico)}`,
          { signal: controller.signal },
        );
        if (cancelled || !response.ok) return;
        const data = (await response.json()) as PedidoStatusResponse;
        if (cancelled) return;
        if (data.statusPagamento === "EXPIRADO") setExpiradoNoServidor(true);
        if (["PAGO", "CANCELADO", "FALHOU"].includes(data.statusPagamento)) {
          goToResult(data.statusPagamento);
        }
      } catch {
        // falha de rede pontual — tenta de novo no próximo ciclo
      } finally {
        inFlight = false;
      }
    };

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(interval);
    };
  }, [status, payment, navigate, clearCart, state]);

  useEffect(() => {
    if (status !== "processando" || !resultadoPendente || !payment) return;

    const timer = setTimeout(() => {
      if (resultadoPendente === "PAGO") {
        clearCart();
        navigate("/pedido-confirmado", {
          state: {
            pedidoId: payment.pedidoId,
            tokenPublico: payment.tokenPublico,
            items: state!.items,
            totalCentavos: payment.totalCentavos,
          },
        });
      } else {
        navigate("/pagamento-nao-aprovado", {
          state: { items: state!.items, totalCentavos: payment.totalCentavos },
        });
      }
    }, PROCESSANDO_DELAY_MS);

    return () => clearTimeout(timer);
  }, [status, resultadoPendente, payment, navigate, clearCart, state]);

  const handleCopy = () => {
    if (!payment?.qrCode || prazoEncerrado) return;
    navigator.clipboard.writeText(payment.qrCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!state) return null;

  const minutes =
    timeLeft != null ? Math.floor(timeLeft / 60).toString().padStart(2, "0") : "--";
  const seconds =
    timeLeft != null ? (timeLeft % 60).toString().padStart(2, "0") : "--";

  return (
    <div className="aguardando-page">
      <div className="aguardando-wave-container" aria-hidden="true">
        <svg
          viewBox="0 0 1440 434"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          preserveAspectRatio="none"
        >
          <path
            d="M0 0V324.8C120 433.067 253.333 460.133 400 406C546.667 351.867 680 340.267 800 371.2C920 402.133 1053.33 394.4 1200 348C1320 309.333 1400 270.667 1440 232V0H0Z"
            fill="#EDDCC6"
          />
        </svg>
      </div>

      <Header minimal />

      <main className="aguardando-content">
        <div className="aguardando-card">
          {status === "criando" && loadingStep === 1 && (
            <div className="aguardando-step">
              <img
                src={cakeCartImage}
                alt=""
                aria-hidden="true"
                className="aguardando-mascot aguardando-mascot--walk"
              />
              <h1 className="payment-title">Preparando seu pedido...</h1>
              <p className="payment-subtitle">
                Organizando os itens do seu carrinho de doçuras artesanais
              </p>
            </div>
          )}

          {status === "criando" && loadingStep === 2 && (
            <div className="aguardando-step">
              <div className="loading-pix-icon" aria-hidden="true">
                <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path className="pix-arm" d="M21 17 L7 3 L3 7 L17 21 Q19 19 21 17Z" />
                  <path className="pix-arm" d="M27 17 L41 3 L45 7 L31 21 Q29 19 27 17Z" />
                  <path className="pix-arm" d="M31 27 L45 41 L41 45 L27 31 Q29 29 31 27Z" />
                  <path className="pix-arm" d="M17 27 L3 41 L7 45 L21 31 Q19 29 17 27Z" />
                </svg>
              </div>
              <h1 className="payment-title">Gerando pagamento...</h1>
              <p className="payment-subtitle">
                Criando seu código Pix para garantir seus doces fresquinhos
              </p>
            </div>
          )}

          {status === "processando" && (
            <div className="aguardando-step">
              <div className="processando-clock-icon" aria-hidden="true">
                <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="32" cy="32" r="28" stroke="#634738" strokeWidth="2" />
                  <line
                    x1="32" y1="32" x2="32" y2="16"
                    stroke="#634738" strokeWidth="2" strokeLinecap="round"
                    className="processando-clock-minute"
                  />
                  <line
                    x1="32" y1="32" x2="42" y2="32"
                    stroke="#634738" strokeWidth="2" strokeLinecap="round"
                    className="processando-clock-hour"
                  />
                  <circle cx="32" cy="32" r="2" fill="#634738" />
                </svg>
              </div>
              <h1 className="payment-title">Processando pagamento...</h1>
              <p className="payment-subtitle">Confirmando o recebimento do seu Pix</p>
              <div className="processando-dots">
                <span />
                <span />
                <span />
              </div>
            </div>
          )}

          {status === "erro" && (
            <div className="aguardando-step">
              <div className="status-icon status-icon--error">
                <svg width="20" height="20" viewBox="0 0 14 14" fill="none">
                  <path
                    d="M1 1L13 13M13 1L1 13"
                    stroke="#D38B80"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                  />
                </svg>
              </div>
              <h1 className="payment-title">Não foi possível gerar o Pix</h1>
              <p className="payment-subtitle">{errorMessage}</p>
              <button
                className="payment-btn-primary"
                onClick={() => navigate("/checkout")}
              >
                Voltar ao checkout
              </button>
            </div>
          )}

          {status === "pronto" && payment && (
            <div className="aguardando-step">
              <h1 className="payment-title">Aguardando pagamento</h1>
              <p className="payment-subtitle">
                {prazoEncerrado
                  ? "Prazo do QR encerrado. Ainda não confirmamos o pagamento."
                  : "Escaneie o QR Code abaixo para pagar via Pix"}
              </p>

              <div className="qr-code">
                {!prazoEncerrado && payment.qrCodeBase64 ? (
                  <img
                    src={`data:image/png;base64,${payment.qrCodeBase64}`}
                    alt="QR Code Pix"
                  />
                ) : null}
              </div>

              <div className="pix-copy-row">
                <span className="pix-copy-label">PIX COPIA E COLA</span>
                <button className="pix-copy-btn" onClick={handleCopy} disabled={prazoEncerrado}>
                  {copied ? "Copiado!" : "Copiar código"}
                </button>
              </div>
              <div className="pix-code-box">{prazoEncerrado ? "Código Pix com prazo encerrado" : payment.qrCode}</div>

              {timeLeft != null && (
                <div className="pix-timer">
                  ⏱ {prazoEncerrado ? "Prazo encerrado" : "Expira em"}{" "}
                  <strong>
                    {prazoEncerrado ? "00:00" : `${minutes}:${seconds}`}
                  </strong>
                </div>
              )}

              <div className="payment-divider" />
              {state.items.map((item) => (
                <div key={item.id} className="payment-order-item">
                  <span>
                    {item.name} ×{item.quantity}
                  </span>
                  <span>
                    R${" "}
                    {(item.price * item.quantity).toFixed(2).replace(".", ",")}
                  </span>
                </div>
              ))}
              <div className="payment-total-row">
                <span className="payment-total-label">Total</span>
                <span className="payment-total-value">
                  R$ {(payment.totalCentavos / 100).toFixed(2).replace(".", ",")}
                </span>
              </div>
              <p className="payment-notice">
                O pedido será confirmado automaticamente assim que o pagamento
                for recebido.
                {prazoEncerrado && <> <Link to={`/pedido/${encodeURIComponent(payment.tokenPublico)}`}>Acompanhar pedido</Link></>}
              </p>
            </div>
          )}
        </div>
      </main>

      <Footer />
    </div>
  );
}
