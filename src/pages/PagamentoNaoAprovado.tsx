import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { CartItem } from "../context/CartContext";
import Header from "../components/Header";
import Footer from "../components/Footer";
import sadBoloImage from "../assets/sad-bolo-image.png";
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
    <div className="recusado-page">
      {/* Onda decorativa */}
      <div className="recusado-wave" aria-hidden="true">
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

      <main className="recusado-content">
        {/* Hero */}
        <div className="recusado-hero">
          <img
            src={sadBoloImage}
            alt=""
            aria-hidden="true"
            className="recusado-mascot recusado-mascot--shake"
          />
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
    </div>
  );
}
