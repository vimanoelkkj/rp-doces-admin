import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import StorefrontFrame from "../components/StorefrontFrame";
import Footer from "../components/Footer";
import { useAcompanharPagamento } from "../hooks/useAcompanharPagamento";
import { useCheckoutPix } from "../hooks/useCheckoutPix";
import { useContagemRegressiva } from "../hooks/useContagemRegressiva";
import { type CheckoutState, formatarContagem } from "../lib/aguardandoPagamento";
import PreparandoPedido from "./PreparandoPedido";
import GerandoPagamento from "./GerandoPagamento";
import ProcessandoPagamento from "./ProcessandoPagamento";
import "./AguardandoPagamento.css";

export default function AguardandoPagamento() {
  const location = useLocation();
  const navigate = useNavigate();
  // Tentativa de checkout fixada na montagem. `location.state` pode ser substituído ou virar null
  // com a página montada (navegação para a mesma rota), mas o Pix criado, a tela e o destino final
  // pertencem sempre à tentativa que o gerou.
  const [tentativa] = useState(() => location.state as CheckoutState | null);

  const { fase, etapa, payment, errorMessage, isEstoqueError } = useCheckoutPix(tentativa);
  const timeLeft = useContagemRegressiva(payment?.expiresAt);
  const { resultado, expiradoNoServidor } = useAcompanharPagamento(
    payment,
    fase === "pronto",
    tentativa
  );
  const [copied, setCopied] = useState(false);
  const prazoEncerrado = timeLeft === 0 || expiradoNoServidor;

  // "processando" aparece só depois que a confirmação do pagamento chega de verdade (via
  // polling), como uma transição breve antes de navegar para o resultado — nunca substitui a
  // tela do QR Code, que é a etapa real de espera do cliente. Sem barra de progresso: não é uma
  // etapa fake com passos conhecidos, é só uma pausa perceptível pra não pular direto pro
  // resultado no instante em que detectamos a mudança de status.
  const status = resultado !== null ? "processando" : fase;

  const handleCopy = () => {
    if (!payment?.qrCode || prazoEncerrado) return;
    navigator.clipboard.writeText(payment.qrCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!tentativa) return null;

  // Telas de loading tomam a tela inteira (mesmo tratamento visual do
  // Figma) — sem Header/Footer/onda do storefront por trás.
  if (status === "criando" && etapa === 1) return <PreparandoPedido />;
  if (status === "criando" && etapa === 2) return <GerandoPagamento />;
  if (status === "processando") return <ProcessandoPagamento />;

  const { minutes, seconds } = formatarContagem(timeLeft);

  return (
    <StorefrontFrame className="aguardando-page">
      <main className="aguardando-content">
        <div className="aguardando-card">
          {status === "erro" && (
            <div className="aguardando-step">
              <div className="status-icon status-icon--error">
                <svg aria-hidden="true" width="20" height="20" viewBox="0 0 14 14" fill="none">
                  <path
                    d="M1 1L13 13M13 1L1 13"
                    stroke="#D38B80"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                  />
                </svg>
              </div>
              <h1 className="payment-title">
                {isEstoqueError ? "Estoque indisponível" : "Não foi possível gerar o Pix"}
              </h1>
              <p className="payment-subtitle">{errorMessage}</p>
              <div
                className="aguardando-error-actions"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "10px",
                  width: "100%",
                  maxWidth: "300px",
                  margin: "20px auto 0"
                }}
              >
                <button
                  type="button"
                  className="payment-btn-primary"
                  onClick={() => navigate("/checkout")}
                >
                  Voltar ao checkout
                </button>
                {isEstoqueError && (
                  <button
                    type="button"
                    className="payment-btn-secondary"
                    onClick={() => navigate("/cardapio")}
                  >
                    Revisar no cardápio
                  </button>
                )}
              </div>
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
                  <img src={`data:image/png;base64,${payment.qrCodeBase64}`} alt="QR Code Pix" />
                ) : null}
              </div>

              <div className="pix-copy-row">
                <span className="pix-copy-label">PIX COPIA E COLA</span>
                <button
                  type="button"
                  className="pix-copy-btn"
                  onClick={handleCopy}
                  disabled={prazoEncerrado}
                >
                  {copied ? "Copiado!" : "Copiar código"}
                </button>
              </div>
              <div className="pix-code-box selectable">
                {prazoEncerrado ? "Código Pix com prazo encerrado" : payment.qrCode}
              </div>

              {timeLeft != null && (
                <div className="pix-timer">
                  ⏱ {prazoEncerrado ? "Prazo encerrado" : "Expira em"}{" "}
                  <strong>{prazoEncerrado ? "00:00" : `${minutes}:${seconds}`}</strong>
                </div>
              )}

              <div className="payment-divider" />
              {tentativa.items.map(item => (
                <div key={item.id} className="payment-order-item">
                  <span>
                    {item.name} ×{item.quantity}
                  </span>
                  <span>R$ {(item.price * item.quantity).toFixed(2).replace(".", ",")}</span>
                </div>
              ))}
              <div className="payment-total-row">
                <span className="payment-total-label">Total</span>
                <span className="payment-total-value">
                  R$ {(payment.totalCentavos / 100).toFixed(2).replace(".", ",")}
                </span>
              </div>
              <p className="payment-notice">
                O pedido será confirmado automaticamente assim que o pagamento for recebido.
                {prazoEncerrado && (
                  <>
                    {" "}
                    <Link to={`/pedido/${encodeURIComponent(payment.tokenPublico)}`}>
                      Acompanhar pedido
                    </Link>
                  </>
                )}
              </p>
            </div>
          )}
        </div>
      </main>

      <Footer watermarkOnly />
    </StorefrontFrame>
  );
}
