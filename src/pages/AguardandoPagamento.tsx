import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import Header from "../components/Header";
import Footer from "../components/Footer";
import { CartItem } from "../context/CartContext";
import "./AguardandoPagamento.css";

interface CheckoutState {
  items: CartItem[];
  cliente: { nome: string; whatsapp: string };
  recado?: string;
}

interface CheckoutResponse {
  paymentId: number;
  status: string;
  qrCode: string | null;
  qrCodeBase64: string | null;
  ticketUrl: string | null;
  expiresAt: string | null;
  totalCentavos: number;
}

type Status = "criando" | "pronto" | "erro";

export default function AguardandoPagamento() {
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state as CheckoutState | null;

  const [status, setStatus] = useState<Status>("criando");
  const [payment, setPayment] = useState<CheckoutResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [copied, setCopied] = useState(false);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);

  useEffect(() => {
    if (!state || state.items.length === 0) {
      navigate("/cardapio");
      return;
    }

    const controller = new AbortController();

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
      }),
    })
      .then(async (response) => {
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.error || "Falha ao criar pagamento Pix");
        }
        return response.json() as Promise<CheckoutResponse>;
      })
      .then((data) => {
        setPayment(data);
        setStatus("pronto");
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setErrorMessage(err.message);
        setStatus("erro");
      });

    return () => controller.abort();
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

  const handleCopy = () => {
    if (!payment?.qrCode) return;
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
          {status === "criando" && (
            <div className="aguardando-step">
              <div className="loading-dots">
                <span />
                <span />
                <span />
              </div>
              <h1 className="payment-title">Preparando Pix...</h1>
              <p className="payment-subtitle">
                Gerando o código de pagamento para você
              </p>
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
                Escaneie o QR Code abaixo para pagar via Pix
              </p>

              <div className="qr-code">
                {payment.qrCodeBase64 ? (
                  <img
                    src={`data:image/png;base64,${payment.qrCodeBase64}`}
                    alt="QR Code Pix"
                  />
                ) : null}
              </div>

              <div className="pix-copy-row">
                <span className="pix-copy-label">PIX COPIA E COLA</span>
                <button className="pix-copy-btn" onClick={handleCopy}>
                  {copied ? "Copiado!" : "Copiar código"}
                </button>
              </div>
              <div className="pix-code-box">{payment.qrCode}</div>

              {timeLeft != null && (
                <div className="pix-timer">
                  ⏱ Expira em{" "}
                  <strong>
                    {minutes}:{seconds}
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
              </p>
            </div>
          )}
        </div>
      </main>

      <Footer />
    </div>
  );
}
