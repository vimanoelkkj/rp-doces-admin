import { Fragment, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import Header from "../components/Header";
import Footer from "../components/Footer";
import "./PedidoConfirmado.css";

interface PedidoItem {
  produto_nome: string;
  quantidade: number;
  valor_unitario_centavos: number;
  valor_total_centavos: number;
}

interface PedidoDetalhe {
  pedidoId: number;
  clienteNome: string;
  valorTotalCentavos: number;
  criadoEm: string;
  itens: PedidoItem[];
  statusPagamento: "PENDENTE" | "PAGO" | "CANCELADO" | "EXPIRADO";
  statusPreparo: "RECEBIDO" | "EM_PREPARACAO" | "PRONTO_PARA_RETIRADA" | "RETIRADO";
}

const STEPS: { key: PedidoDetalhe["statusPreparo"]; label: string }[] = [
  { key: "RECEBIDO", label: "Pedido recebido" },
  { key: "EM_PREPARACAO", label: "Em preparação" },
  { key: "PRONTO_PARA_RETIRADA", label: "Pronto para retirada" },
  { key: "RETIRADO", label: "Retirado" },
];

const STATUS_PAGAMENTO_LABEL: Record<PedidoDetalhe["statusPagamento"], string> = {
  PENDENTE: "Aguardando pagamento",
  PAGO: "✓ Confirmado",
  CANCELADO: "Pagamento não aprovado",
  EXPIRADO: "Pix expirado",
};

export default function AcompanharPedido() {
  const { token } = useParams<{ token: string }>();
  const [pedido, setPedido] = useState<PedidoDetalhe | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/pedido?token=${encodeURIComponent(token)}`)
      .then(async (response) => {
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.error || "Pedido não encontrado");
        }
        return response.json() as Promise<PedidoDetalhe>;
      })
      .then(setPedido)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [token]);

  const currentIndex = pedido
    ? STEPS.findIndex((s) => s.key === pedido.statusPreparo)
    : -1;

  return (
    <div className="confirmado-page">
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
        {loading && (
          <div className="confirmado-hero">
            <p>Carregando pedido…</p>
          </div>
        )}

        {error && (
          <div className="confirmado-hero">
            <h1>Pedido não encontrado</h1>
            <p>{error}</p>
          </div>
        )}

        {pedido && (
          <>
            <div className="confirmado-hero">
              <h1>Acompanhe seu pedido</h1>
              <p>Olá, {pedido.clienteNome}</p>
            </div>

            <div className="confirmado-card">
              <div className="confirmado-header">
                <div>
                  <h2 className="confirmado-order-id">
                    Pedido #{pedido.pedidoId}
                  </h2>
                  <span className="confirmado-date">
                    Realizado em{" "}
                    {new Date(pedido.criadoEm).toLocaleDateString("pt-BR", {
                      day: "2-digit",
                      month: "long",
                      year: "numeric",
                    })}
                  </span>
                </div>
                <span className="confirmado-badge">
                  {STATUS_PAGAMENTO_LABEL[pedido.statusPagamento]}
                </span>
              </div>

              <div className="confirmado-divider" />

              {pedido.statusPagamento === "PAGO" && (
                <>
                  <div className="confirmado-label">
                    ACOMPANHAMENTO DE PREPARO
                  </div>
                  <div className="confirmado-timeline">
                    {STEPS.map((step, i) => (
                      <Fragment key={step.key}>
                        <div
                          className={`tl-step ${
                            i < currentIndex
                              ? "tl-step--done"
                              : i === currentIndex
                                ? "tl-step--current"
                                : ""
                          }`}
                        >
                          <div className="tl-dot">
                            {i < currentIndex ? (
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                                <path
                                  d="M5 13L9 17L19 7"
                                  stroke="#fff"
                                  strokeWidth="3"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                              </svg>
                            ) : i === currentIndex ? (
                              <span className="tl-dots">
                                <span />
                                <span />
                                <span />
                              </span>
                            ) : null}
                          </div>
                          <span>{step.label}</span>
                        </div>
                        {i < STEPS.length - 1 && (
                          <div
                            className={`tl-line ${
                              i < currentIndex
                                ? "tl-line--done"
                                : i === currentIndex
                                  ? "tl-line--active"
                                  : ""
                            }`}
                          />
                        )}
                      </Fragment>
                    ))}
                  </div>
                  <div className="confirmado-divider" />
                </>
              )}

              <div className="confirmado-label">ITENS DO SEU PEDIDO</div>
              {pedido.itens.map((item, i) => (
                <div key={i} className="confirmado-item">
                  <div className="confirmado-item-info">
                    <span className="confirmado-item-name">
                      {item.produto_nome}
                    </span>
                    <span className="confirmado-item-detail">
                      Quantidade: {item.quantidade}
                    </span>
                  </div>
                  <span className="confirmado-item-price">
                    R${" "}
                    {(item.valor_total_centavos / 100)
                      .toFixed(2)
                      .replace(".", ",")}
                  </span>
                </div>
              ))}

              <div className="confirmado-divider" />

              <div className="confirmado-bottom">
                <div className="confirmado-label">RESUMO</div>
                <div className="confirmado-summary-row confirmado-summary-total">
                  <span>Total</span>
                  <span className="confirmado-total-value">
                    R${" "}
                    {(pedido.valorTotalCentavos / 100)
                      .toFixed(2)
                      .replace(".", ",")}
                  </span>
                </div>
              </div>
            </div>
          </>
        )}
      </main>

      <Footer />
    </div>
  );
}
