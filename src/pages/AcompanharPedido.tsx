import { Fragment, useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import StorefrontFrame from "../components/StorefrontFrame";
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
  statusPagamento: "PENDENTE" | "PAGO" | "CANCELADO" | "EXPIRADO" | "REEMBOLSADO";
  statusPedido: "NOVO" | "PREPARANDO" | "PRONTO" | "ENTREGUE" | "CANCELADO";
}

const STEPS: { key: PedidoDetalhe["statusPedido"]; label: string }[] = [
  { key: "NOVO", label: "Pedido recebido" },
  { key: "PREPARANDO", label: "Em preparação" },
  { key: "PRONTO", label: "Pronto para retirada" },
  { key: "ENTREGUE", label: "Retirado" },
];

const STATUS_PAGAMENTO_LABEL: Record<PedidoDetalhe["statusPagamento"], string> = {
  PENDENTE: "Aguardando pagamento",
  PAGO: "✓ Confirmado",
  CANCELADO: "Pagamento não aprovado",
  EXPIRADO: "Pix expirado",
  REEMBOLSADO: "Reembolsado",
};

export default function AcompanharPedido() {
  const { token } = useParams<{ token: string }>();
  const [pedido, setPedido] = useState<PedidoDetalhe | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const carregarPedido = useCallback(
    async (mostrarLoading = false) => {
      if (!token) return;
      if (mostrarLoading) setLoading(true);

      try {
        const response = await fetch(
          `/api/pedido?token=${encodeURIComponent(token)}`,
          { cache: "no-store" },
        );
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.error || "Pedido não encontrado");
        }

        setPedido((await response.json()) as PedidoDetalhe);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Falha ao atualizar pedido");
      } finally {
        if (mostrarLoading) setLoading(false);
      }
    },
    [token],
  );

  useEffect(() => {
    void carregarPedido(true);
  }, [carregarPedido]);

  useEffect(() => {
    if (!pedido) return;
    if (pedido.statusPedido === "ENTREGUE" || pedido.statusPedido === "CANCELADO") {
      return;
    }

    // Acompanhamento leve: mantém o status operacional sincronizado com o
    // admin sem WebSocket e sem recarregar a página inteira.
    const atualizar = () => void carregarPedido(false);
    const interval = window.setInterval(atualizar, 10_000);
    const aoFocar = () => atualizar();
    const aoFicarVisivel = () => {
      if (document.visibilityState === "visible") atualizar();
    };

    window.addEventListener("focus", aoFocar);
    document.addEventListener("visibilitychange", aoFicarVisivel);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", aoFocar);
      document.removeEventListener("visibilitychange", aoFicarVisivel);
    };
  }, [pedido?.statusPedido, carregarPedido]);

  const currentIndex = pedido
    ? STEPS.findIndex((s) => s.key === pedido.statusPedido)
    : -1;

  return (
    <StorefrontFrame className="confirmado-page">
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
    </StorefrontFrame>
  );
}
