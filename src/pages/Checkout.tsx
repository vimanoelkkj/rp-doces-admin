import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Header from "../components/Header";
import Footer from "../components/Footer";
import { useCart } from "../context/CartContext";
import {
  gravarOperationKey,
  novaOperationKey,
  SLOT_CHECKOUT,
} from "../lib/operationKey";
import "./Checkout.css";

export default function Checkout() {
  const navigate = useNavigate();
  const { cartItems, totalPrice } = useCart();

  const [nome, setNome] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [recado, setRecado] = useState("");
  const [pagamento, setPagamento] = useState("pix");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // A1: a identidade da finalização nasce AQUI, antes do primeiro POST
    // (que só acontece na próxima tela). Submeter o formulário de novo é uma
    // finalização explicitamente nova e recebe uma key nova; retry, abort e
    // remontagem da MESMA finalização reaproveitam esta.
    const operationKey = novaOperationKey();
    gravarOperationKey(SLOT_CHECKOUT, operationKey);
    navigate("/aguardando-pagamento", {
      state: {
        items: cartItems,
        cliente: { nome: nome.trim(), whatsapp: whatsapp.trim() },
        recado: recado.trim(),
        operationKey,
      },
    });
  };

  if (cartItems.length === 0) {
    return (
      <div className="checkout-page">
        <Header />
        <main className="checkout-empty">
          <h1>Seu carrinho está vazio</h1>
          <p>Adicione produtos antes de finalizar o pedido.</p>
          <button
            className="back-to-menu-btn"
            onClick={() => navigate("/cardapio")}
          >
            Ir para o cardápio
          </button>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="checkout-page">
      {/* Onda decorativa — mesma estrutura da Homepage */}
      <div className="checkout-wave-container" aria-hidden="true">
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

      <Header />

      <main className="checkout-content">
        <div className="checkout-card">
          {/* Coluna esquerda — Resumo do pedido */}
          <div className="checkout-order">
            <h2 className="checkout-section-title">Seu pedido</h2>
            <div className="checkout-items">
              {cartItems.map((item) => (
                <div key={item.id} className="checkout-item">
                  <img
                    src={item.image}
                    alt={item.name}
                    className="checkout-item-img"
                  />
                  <div className="checkout-item-info">
                    <span className="checkout-item-name">{item.name}</span>
                    <span className="checkout-item-detail">
                      Qtd {item.quantity} • R${" "}
                      {item.price.toFixed(2).replace(".", ",")}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <div className="checkout-total-row">
              <span className="checkout-total-label">Total do Pedido</span>
              <span className="checkout-total-value">
                R$ {totalPrice.toFixed(2).replace(".", ",")}
              </span>
            </div>
            <p
              className="checkout-back-link"
              onClick={() => navigate("/cardapio")}
            >
              Volte a qualquer momento para alterar seu carrinho.
            </p>
          </div>

          {/* Coluna direita — Formulário */}
          <div className="checkout-form-section">
            <h2 className="checkout-section-title">Seus dados</h2>
            <form onSubmit={handleSubmit} className="checkout-form">
              <div className="form-group">
                <label className="form-label">NOME COMPLETO</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Seu nome"
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">WHATSAPP PARA CONTATO</label>
                <input
                  type="tel"
                  className="form-input"
                  placeholder="(31) 99999-9999"
                  value={whatsapp}
                  onChange={(e) => setWhatsapp(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">ALGUM RECADO — OPCIONAL</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Ex.: sem calda, por favor"
                  value={recado}
                  onChange={(e) => setRecado(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label className="form-label">FORMA DE PAGAMENTO</label>
                <div
                  className={`payment-option ${pagamento === "pix" ? "active" : ""}`}
                  onClick={() => setPagamento("pix")}
                >
                  <div className="payment-radio">
                    <div className="payment-radio-dot" />
                  </div>
                  <span>Pix (Pagamento instantâneo)</span>
                </div>
              </div>

              <button type="submit" className="checkout-submit-btn">
                Pedir agora - R$ {totalPrice.toFixed(2).replace(".", ",")}
              </button>
            </form>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
