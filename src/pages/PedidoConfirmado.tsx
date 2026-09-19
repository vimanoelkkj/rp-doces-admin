import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useCart } from "../context/CartContext";
import { CartItem } from "../context/CartContext";
import Header from "../components/Header";
import Footer from "../components/Footer";
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
          <div className="confirmado-illustration">
            <svg
              className="confirmado-cupcake"
              width="128"
              height="128"
              viewBox="0 0 128 128"
              fill="none"
              aria-hidden="true"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path d="M34 58.5C34 48.6 41.8 40.4 51.7 39.9C54.5 31.8 61.9 26 70.6 26C79.6 26 87.3 32.2 89.9 40.7C98.4 41.9 105 49.2 105 58C105 67.7 97.1 75.5 87.5 75.5H49.5C40.9 75.5 34 68.8 34 60.5V58.5Z" fill="#634738" opacity="0.08"/>
              <path d="M36 56.5C36 47.7 43 40.4 51.8 39.9C54.2 32.5 60.9 27.2 68.9 27.2C77.1 27.2 84.1 32.9 86.3 40.7C94.3 41.8 100.5 48.7 100.5 57C100.5 66.1 93.1 73.5 84 73.5H49.5C42 73.5 36 67.5 36 60V56.5Z" fill="#D38B80"/>
              <path d="M52.5 42.5C55.3 36.9 61.1 33.2 67.9 33.2C73.3 33.2 78.2 35.6 81.4 39.5C80 39.1 78.6 38.9 77.1 38.9C71.7 38.9 66.9 41 63.5 44.4C61.3 42.9 58.6 42 55.8 42C54.7 42 53.6 42.2 52.5 42.5Z" fill="#EADFD3" opacity="0.95"/>
              <circle cx="79.5" cy="23.5" r="5.5" fill="#634738"/>
              <path d="M82.8 19.5C84.8 16.5 88.2 14.8 91.8 14.8C90.5 18.4 87.8 21.1 84.1 22.3L82.8 19.5Z" fill="#D38B80"/>
              <path d="M47 73.5H89L83.4 99.7C82.6 103.2 79.5 105.8 75.9 105.8H60.1C56.5 105.8 53.4 103.2 52.6 99.7L47 73.5Z" fill="#634738"/>
              <path d="M47 73.5H89" stroke="#EADFD3" strokeWidth="2.5" strokeLinecap="round" opacity="0.75"/>
              <path d="M58 79L55.8 101" stroke="#EADFD3" strokeWidth="2.6" strokeLinecap="round" opacity="0.95"/>
              <path d="M68 79V102" stroke="#EADFD3" strokeWidth="2.6" strokeLinecap="round" opacity="0.95"/>
              <path d="M78 79L80.2 101" stroke="#EADFD3" strokeWidth="2.6" strokeLinecap="round" opacity="0.95"/>
              <ellipse cx="59" cy="56" rx="4.5" ry="3.2" fill="#EADFD3" opacity="0.65"/>
            </svg>

            <svg
              className="confirmado-check"
              width="36"
              height="36"
              viewBox="0 0 36 36"
              fill="none"
              aria-hidden="true"
            >
              <circle cx="18" cy="18" r="18" fill="#634738"/>
              <path d="M11 18L16 23L25 13" stroke="#EADFD3" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
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
