import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useCart } from "../context/CartContext";
import { CartItem } from "../context/CartContext";
import Header from "../components/Header";
import Footer from "../components/Footer";
import happyBoloImage from "../assets/happy-bolo-image.png";
import "./PedidoConfirmado.css";

interface ConfirmadoState {
  pedidoId: number;
  tokenPublico?: string;
  items: CartItem[];
  totalCentavos: number;
}

type StatusPedido = "NOVO" | "PREPARANDO" | "PRONTO" | "ENTREGUE" | "CANCELADO";

interface PedidoStatusResponse {
  statusPedido: StatusPedido;
}

export default function PedidoConfirmado() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as ConfirmadoState | null;
  const { clearCart } = useCart();
  const [statusPedido, setStatusPedido] = useState<StatusPedido>("PREPARANDO");

  useEffect(() => {
    if (!state) {
      navigate("/", { replace: true });
    }
  }, [state, navigate]);

  const atualizarStatus = useCallback(async () => {
    if (!state?.tokenPublico) return;

    try {
      const response = await fetch(
        `/api/pedido?token=${encodeURIComponent(state.tokenPublico)}`,
        { cache: "no-store" },
      );
      if (!response.ok) return;
      const pedido = (await response.json()) as PedidoStatusResponse;
      setStatusPedido(pedido.statusPedido);
    } catch {
      // Falha pontual de rede não muda a tela; tenta novamente no próximo ciclo.
    }
  }, [state?.tokenPublico]);

  useEffect(() => {
    if (!state?.tokenPublico) return;

    void atualizarStatus();

    if (statusPedido === "ENTREGUE" || statusPedido === "CANCELADO") return;

    const interval = window.setInterval(() => void atualizarStatus(), 10_000);
    const aoFocar = () => void atualizarStatus();
    const aoFicarVisivel = () => {
      if (document.visibilityState === "visible") void atualizarStatus();
    };

    window.addEventListener("focus", aoFocar);
    document.addEventListener("visibilitychange", aoFicarVisivel);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", aoFocar);
      document.removeEventListener("visibilitychange", aoFicarVisivel);
    };
  }, [state?.tokenPublico, statusPedido, atualizarStatus]);

  const handleBackToMenu = () => {
    clearCart();
    navigate("/");
  };

  if (!state) return null;

  const totalPrice = state.totalCentavos / 100;

  return (
    <div className="confirmado-page">
      {/* Onda decorativa */}
      <div className="confirmado-wave" aria-hidden="true">
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

      <main className="confirmado-content">
        {/* Seção Aprovado */}
        <div className="confirmado-hero">
          <img
            src={happyBoloImage}
            alt=""
            aria-hidden="true"
            className="confirmado-mascot confirmado-mascot--bounce"
          />
          <h1>Pagamento aprovado!</h1>
          <p>Seu pedido foi confirmado com sucesso</p>
        </div>

        {/* Card de detalhes */}
        <div className="confirmado-card">
          <div className="confirmado-header">
            <div>
              <h2 className="confirmado-order-id">Pedido #{state.pedidoId}</h2>
              <span className="confirmado-date">
                Realizado em{" "}
                {new Date().toLocaleDateString("pt-BR", {
                  day: "2-digit",
                  month: "long",
                  year: "numeric",
                })}{" "}
                às{" "}
                {new Date().toLocaleTimeString("pt-BR", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </div>
            <span className="confirmado-badge">✓ Confirmado</span>
          </div>

          <div className="confirmado-divider" />

          {/* Timeline */}
          <div className="confirmado-label">ACOMPANHAMENTO DE PREPARO</div>
          <div className="confirmado-timeline">
            <div className="tl-step tl-step--done">
              <div className="tl-dot">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M5 13L9 17L19 7"
                    stroke="#fff"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
              <span>Pedido recebido</span>
            </div>
            <div className="tl-line tl-line--done" />
            <div className="tl-step tl-step--done">
              <div className="tl-dot">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M5 13L9 17L19 7"
                    stroke="#fff"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
              <span>Pagamento confirmado</span>
            </div>
            <div
              className={`tl-line ${
                statusPedido === "PRONTO" || statusPedido === "ENTREGUE"
                  ? "tl-line--done"
                  : "tl-line--active"
              }`}
            />
            <div
              className={`tl-step ${
                statusPedido === "PRONTO" || statusPedido === "ENTREGUE"
                  ? "tl-step--done"
                  : "tl-step--current"
              }`}
            >
              <div className="tl-dot">
                {statusPedido === "PRONTO" || statusPedido === "ENTREGUE" ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M5 13L9 17L19 7"
                      stroke="#fff"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : (
                  <span className="tl-dots">
                    <span />
                    <span />
                    <span />
                  </span>
                )}
              </div>
              <span>Em preparação</span>
            </div>
            <div
              className={`tl-line ${
                statusPedido === "ENTREGUE"
                  ? "tl-line--done"
                  : statusPedido === "PRONTO"
                    ? "tl-line--active"
                    : ""
              }`}
            />
            <div
              className={`tl-step ${
                statusPedido === "ENTREGUE"
                  ? "tl-step--done"
                  : statusPedido === "PRONTO"
                    ? "tl-step--current"
                    : ""
              }`}
            >
              <div className="tl-dot">
                {statusPedido === "ENTREGUE" ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M5 13L9 17L19 7"
                      stroke="#fff"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : statusPedido === "PRONTO" ? (
                  <span className="tl-dots">
                    <span />
                    <span />
                    <span />
                  </span>
                ) : null}
              </div>
              <span>{statusPedido === "ENTREGUE" ? "Retirado" : "Pronto para retirada"}</span>
            </div>
          </div>

          <div className="confirmado-divider" />

          {/* Itens */}
          <div className="confirmado-label">ITENS DO SEU PEDIDO</div>
          {state.items.map((item) => (
            <div key={item.id} className="confirmado-item">
              <img
                src={item.image}
                alt={item.name}
                className="confirmado-item-img"
              />
              <div className="confirmado-item-info">
                <span className="confirmado-item-name">{item.name}</span>
                <span className="confirmado-item-detail">
                  Quantidade: {item.quantity}
                </span>
              </div>
              <span className="confirmado-item-price">
                R$ {(item.price * item.quantity).toFixed(2).replace(".", ",")}
              </span>
            </div>
          ))}

          <div className="confirmado-divider" />

          {/* Resumo de pagamento */}
          <div className="confirmado-bottom">
            <div className="confirmado-label">RESUMO DE PAGAMENTO</div>
            <div className="confirmado-summary-row">
              <span>Subtotal</span>
              <span>R$ {totalPrice.toFixed(2).replace(".", ",")}</span>
            </div>
            <div className="confirmado-summary-row">
              <span>Forma de Pagamento</span>
              <span>Pix</span>
            </div>
            <div className="confirmado-summary-row confirmado-summary-total">
              <span>Total Pago</span>
              <span className="confirmado-total-value">
                R$ {totalPrice.toFixed(2).replace(".", ",")}
              </span>
            </div>
          </div>

          <button className="confirmado-btn" onClick={handleBackToMenu}>
            VOLTAR AO INÍCIO
          </button>
          {state.tokenPublico && (
            <Link
              to={`/pedido/${state.tokenPublico}`}
              className="confirmado-track-link"
            >
              Acompanhar este pedido depois
            </Link>
          )}
        </div>
      </main>

      <Footer />
    </div>
  );
}
