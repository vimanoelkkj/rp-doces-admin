import { useEffect } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useCart } from "../context/CartContext";
import type { CartItem } from "../context/CartContext";
import StorefrontFrame from "../components/StorefrontFrame";
import ConfirmadoIlustracao from "../components/ConfirmadoIlustracao";
import ConfirmadoTimeline from "../components/ConfirmadoTimeline";
import Footer from "../components/Footer";
import { usePedidoConfirmadoStatus } from "../hooks/usePedidoConfirmadoStatus";
import { lerUltimoPedido } from "../lib/ultimoPedido";
import "./PedidoConfirmado.css";

interface ConfirmadoState {
  pedidoId: number;
  tokenPublico?: string;
  items: CartItem[];
  totalCentavos: number;
}

export default function PedidoConfirmado() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as ConfirmadoState | null;
  const { clearCart } = useCart();

  useEffect(() => {
    if (!state) {
      // Sem state (outra aba, navegador reaberto): reencontra o último pedido deste
      // navegador; sem registro válido, volta para a Home como antes.
      const token = lerUltimoPedido();
      navigate(token ? `/pedido/${encodeURIComponent(token)}` : "/", { replace: true });
    }
  }, [state, navigate]);

  const { statusPedido, encerrado } = usePedidoConfirmadoStatus(state?.tokenPublico);

  const handleBackToMenu = () => {
    clearCart();
    navigate("/");
  };

  if (!state) return null;

  if (encerrado && state.tokenPublico) {
    return <Navigate to={`/pedido/${encodeURIComponent(state.tokenPublico)}`} replace />;
  }

  const totalPrice = state.totalCentavos / 100;

  return (
    <StorefrontFrame className="confirmado-page">
      <main className="confirmado-content">
        {/* Seção Aprovado */}
        <div className="confirmado-hero">
          <ConfirmadoIlustracao />
          <h1>Pagamento aprovado!</h1>
          <p>Seu pedido foi confirmado com sucesso</p>
        </div>

        {/* Card de detalhes */}
        <div className="confirmado-card">
          <div className="confirmado-header">
            <div>
              <h2 className="confirmado-order-id selectable">Pedido #{state.pedidoId}</h2>
              <span className="confirmado-date">
                Realizado em{" "}
                {new Date().toLocaleDateString("pt-BR", {
                  day: "2-digit",
                  month: "long",
                  year: "numeric"
                })}{" "}
                às{" "}
                {new Date().toLocaleTimeString("pt-BR", {
                  hour: "2-digit",
                  minute: "2-digit"
                })}
              </span>
            </div>
            <span className="confirmado-badge">✓ Confirmado</span>
          </div>

          <div className="confirmado-divider" />

          {/* Timeline */}
          <div className="confirmado-label">ACOMPANHAMENTO DE PREPARO</div>
          <ConfirmadoTimeline statusPedido={statusPedido} />

          <div className="confirmado-divider" />

          {/* Itens */}
          <div className="confirmado-label">ITENS DO SEU PEDIDO</div>
          {state.items.map(item => (
            <div key={item.id} className="confirmado-item">
              <img src={item.image} alt={item.name} className="confirmado-item-img" />
              <div className="confirmado-item-info">
                <span className="confirmado-item-name">{item.name}</span>
                <span className="confirmado-item-detail">Quantidade: {item.quantity}</span>
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

          <button type="button" className="confirmado-btn" onClick={handleBackToMenu}>
            VOLTAR AO INÍCIO
          </button>
          {state.tokenPublico && (
            <Link to={`/pedido/${state.tokenPublico}`} className="confirmado-track-link">
              Acompanhar este pedido depois
            </Link>
          )}
        </div>
      </main>

      <Footer />
    </StorefrontFrame>
  );
}
