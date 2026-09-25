import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { CartItem } from "../context/CartContext";
import StorefrontFrame from "../components/StorefrontFrame";
import Footer from "../components/Footer";
import "./PagamentoNaoAprovado.css";

interface RecusadoState {
  items: CartItem[];
  totalCentavos: number;
}

export default function PagamentoNaoAprovado() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as RecusadoState | null;

  useEffect(() => {
    if (!state) {
      navigate("/", { replace: true });
    }
  }, [state, navigate]);

  const handleRetry = () => {
    navigate("/checkout");
  };

  if (!state) return null;

  const totalPrice = state.totalCentavos / 100;

  return (
    <StorefrontFrame className="recusado-page">
      <main className="recusado-content">
        {/* Hero */}
        <div className="recusado-hero">
          <div className="recusado-illustration">
            <svg
              className="recusado-cupcake"
              width="140"
              height="140"
              viewBox="0 0 140 140"
              fill="none"
              aria-hidden="true"
              xmlns="http://www.w3.org/2000/svg"
            >
              {/* Ground hint */}
              <ellipse cx="70" cy="120" rx="50" ry="3" fill="#634738" opacity="0.05"/>

              {/* Fallen cupcake (rotated, lying on side) */}
              <g transform="rotate(110 65 85)">
                <path d="M47 73H89L83.4 99.7C82.6 103.2 79.5 105.8 75.9 105.8H60.1C56.5 105.8 53.4 103.2 52.6 99.7L47 73Z" fill="#634738" opacity="0.65"/>
                <path d="M47 73H89" stroke="#EADFD3" strokeWidth="2.2" strokeLinecap="round" opacity="0.45"/>
                <path d="M58 79L55.8 101" stroke="#EADFD3" strokeWidth="2.2" strokeLinecap="round" opacity="0.5"/>
                <path d="M68 79V102" stroke="#EADFD3" strokeWidth="2.2" strokeLinecap="round" opacity="0.5"/>
                <path d="M78 79L80.2 101" stroke="#EADFD3" strokeWidth="2.2" strokeLinecap="round" opacity="0.5"/>
                <path d="M36 56.5C36 47.7 43 40.4 51.8 39.9C54.2 32.5 60.9 27.2 68.9 27.2C77.1 27.2 84.1 32.9 86.3 40.7C94.3 41.8 100.5 48.7 100.5 57C100.5 66.1 93.1 73.5 84 73.5H49.5C42 73.5 36 67.5 36 60V56.5Z" fill="#D38B80" opacity="0.6"/>
                <path d="M52.5 42.5C55.3 36.9 61.1 33.2 67.9 33.2C73.3 33.2 78.2 35.6 81.4 39.5C80 39.1 78.6 38.9 77.1 38.9C71.7 38.9 66.9 41 63.5 44.4C61.3 42.9 58.6 42 55.8 42C54.7 42 53.6 42.2 52.5 42.5Z" fill="#EADFD3" opacity="0.4"/>
                <ellipse cx="59" cy="56" rx="4.5" ry="3.2" fill="#EADFD3" opacity="0.3"/>
              </g>

              {/* Frosting splat on the ground */}
              <ellipse cx="48" cy="116" rx="18" ry="5" fill="#D38B80" opacity="0.35"/>
              <ellipse cx="42" cy="114" rx="8" ry="3" fill="#D38B80" opacity="0.25"/>
              <ellipse cx="58" cy="118" rx="6" ry="2.5" fill="#D38B80" opacity="0.2"/>

              {/* Frosting drops */}
              <circle cx="34" cy="112" r="2.5" fill="#D38B80" opacity="0.3"/>
              <circle cx="62" cy="110" r="2" fill="#D38B80" opacity="0.25"/>
              <circle cx="30" cy="116" r="1.5" fill="#D38B80" opacity="0.2"/>

              {/* Cherry rolled away */}
              <circle cx="115" cy="118" r="5.5" fill="#634738" opacity="0.55"/>
              <path d="M118 114C120 111 122 110 124 110" stroke="#D38B80" strokeWidth="1.2" strokeLinecap="round" opacity="0.4"/>

              {/* Crumb trail */}
              <circle cx="82" cy="120" r="1.5" fill="#634738" opacity="0.12"/>
              <circle cx="92" cy="119" r="1" fill="#634738" opacity="0.1"/>
              <circle cx="100" cy="120" r="1.2" fill="#634738" opacity="0.08"/>
              <circle cx="108" cy="119" r="0.8" fill="#634738" opacity="0.06"/>
            </svg>

            <svg
              className="recusado-badge"
              width="36"
              height="36"
              viewBox="0 0 36 36"
              fill="none"
              aria-hidden="true"
            >
              <circle cx="18" cy="18" r="18" fill="#8C7A76"/>
              <path d="M13 13L23 23" stroke="#EADFD3" strokeWidth="3" strokeLinecap="round"/>
              <path d="M23 13L13 23" stroke="#EADFD3" strokeWidth="3" strokeLinecap="round"/>
            </svg>
          </div>
          <h1>Pagamento não aprovado</h1>
          <p>Houve um problema com o seu pagamento</p>
        </div>

        {/* Card */}
        <div className="recusado-card">
          {/* Alerta */}
          <div className="recusado-alert">
            <span className="recusado-alert-icon">⚠️</span>
            <div>
              <strong>O que aconteceu?</strong>
              <p>
                Não recebemos confirmação de aprovação deste pagamento.
                Se você já pagou, confira o comprovante e fale conosco antes de tentar novamente.
              </p>
            </div>
          </div>

          <div className="recusado-divider" />

          {/* Itens do pedido */}
          <div className="recusado-label">ITENS DO SEU PEDIDO</div>
          {state.items.map((item) => (
            <div key={item.id} className="recusado-item">
              <img
                src={item.image}
                alt={item.name}
                className="recusado-item-img"
              />
              <div className="recusado-item-info">
                <span className="recusado-item-name">{item.name}</span>
                <span className="recusado-item-detail">
                  Quantidade: {item.quantity}
                </span>
              </div>
              <span className="recusado-item-price">
                R$ {(item.price * item.quantity).toFixed(2).replace(".", ",")}
              </span>
            </div>
          ))}

          <div className="recusado-divider" />

          {/* Resumo */}
          <div className="recusado-label">RESUMO</div>
          <div className="recusado-summary-row">
            <span>Subtotal</span>
            <span>R$ {totalPrice.toFixed(2).replace(".", ",")}</span>
          </div>
          <div className="recusado-summary-row recusado-summary-total">
            <span>Valor do pedido</span>
            <span className="recusado-total-value">
              R$ {totalPrice.toFixed(2).replace(".", ",")}
            </span>
          </div>

          <div className="recusado-divider" />

          {/* Ações */}
          <button className="recusado-btn-primary" onClick={handleRetry}>
            TENTAR NOVAMENTE
          </button>
          <button
            className="recusado-btn-secondary"
            onClick={() => navigate("/")}
          >
            Voltar ao início
          </button>

          {/* WhatsApp */}
          <div className="recusado-help">
            <span>📞</span>
            <span>
              Precisa de ajuda?{" "}
              <a
                href="https://wa.me/5519998765432"
                target="_blank"
                rel="noopener noreferrer"
              >
                Fale conosco pelo WhatsApp
              </a>
            </span>
          </div>
        </div>
      </main>

      <Footer />
    </StorefrontFrame>
  );
}
