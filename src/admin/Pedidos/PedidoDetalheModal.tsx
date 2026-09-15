import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import "./PedidoDetalheModal.css";

/* ── Types (espelham o retorno de GET /api/admin/pedidos/:id) ── */
interface PedidoItemRow {
  produto_nome: string;
  emoji: string | null;
  quantidade: number;
  valor_unitario_centavos: number;
  valor_total_centavos: number;
}

interface PedidoRow {
  id: number;
  cliente_nome: string;
  cliente_whatsapp: string;
  recado: string;
  valor_total_centavos: number;
  status_pagamento: string;
  status_preparo: "RECEBIDO" | "EM_PREPARACAO" | "PRONTO_PARA_RETIRADA" | "RETIRADO";
  criado_em: string;
  pago_em: string | null;
}

interface PedidoDetalheResponse {
  pedido: PedidoRow;
  itens: PedidoItemRow[];
}

interface PedidoDetalheModalProps {
  orderId: number;
  onClose: () => void;
  onStatusChanged?: () => void;
  onEdit?: () => void;
}

/* ── Helpers ── */
const formatarPreco = (centavos: number) =>
  `R$ ${(centavos / 100).toFixed(2).replace(".", ",")}`;

const formatarData = (isoLike: string) =>
  new Date(isoLike.replace(" ", "T")).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

const STATUS_LABEL: Record<PedidoRow["status_preparo"], string> = {
  RECEBIDO: "Em produção",
  EM_PREPARACAO: "Em produção",
  PRONTO_PARA_RETIRADA: "Pronto",
  RETIRADO: "Entregue",
};

const STATUS_TYPE: Record<PedidoRow["status_preparo"], "green" | "orange" | "blue"> = {
  RECEBIDO: "orange",
  EM_PREPARACAO: "orange",
  PRONTO_PARA_RETIRADA: "blue",
  RETIRADO: "green",
};

const PROXIMO_STATUS: Record<PedidoRow["status_preparo"], PedidoRow["status_preparo"] | null> = {
  RECEBIDO: "EM_PREPARACAO",
  EM_PREPARACAO: "PRONTO_PARA_RETIRADA",
  PRONTO_PARA_RETIRADA: "RETIRADO",
  RETIRADO: null,
};

const AVANCAR_LABEL: Record<PedidoRow["status_preparo"], string> = {
  RECEBIDO: "Marcar em preparação",
  EM_PREPARACAO: "Marcar como pronto",
  PRONTO_PARA_RETIRADA: "Marcar como retirado",
  RETIRADO: "",
};

/* ── Component ── */
export default function PedidoDetalheModal({
  orderId,
  onClose,
  onStatusChanged,
  onEdit,
}: PedidoDetalheModalProps) {
  const [data, setData] = useState<PedidoDetalheResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [avancando, setAvancando] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/admin/pedidos/${orderId}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("Falha ao carregar pedido");
        return response.json() as Promise<PedidoDetalheResponse>;
      })
      .then((result) => {
        setData(result);
        setError(null);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [orderId]);

  const avancarStatus = () => {
    if (!data) return;
    const proximo = PROXIMO_STATUS[data.pedido.status_preparo];
    if (!proximo) return;

    setAvancando(true);
    fetch(`/api/admin/pedidos/${orderId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ statusPreparo: proximo }),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Falha ao avançar status");
        setData((prev) =>
          prev
            ? { ...prev, pedido: { ...prev.pedido, status_preparo: proximo } }
            : prev,
        );
        onStatusChanged?.();
      })
      .catch((err) => setError(err.message))
      .finally(() => setAvancando(false));
  };

  return createPortal(
    <div className="pedmodal-overlay" onClick={onClose}>
      <div className="pedmodal-card" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="pedmodal-header">
          <h2 className="pedmodal-title">
            Pedido #{orderId}
            {data ? ` - ${data.pedido.cliente_nome}` : ""}
          </h2>
          <div className="pedmodal-header-actions">
            {data && PROXIMO_STATUS[data.pedido.status_preparo] && (
              <button
                className="pedmodal-btn-advance"
                onClick={avancarStatus}
                disabled={avancando}
              >
                {AVANCAR_LABEL[data.pedido.status_preparo]}
              </button>
            )}
            {data && data.pedido.status_preparo !== "RETIRADO" && (
              <button className="pedmodal-btn-edit" onClick={onEdit}>
                Editar pedido
              </button>
            )}
            <button className="pedmodal-btn-close" onClick={onClose}>
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              >
                <line x1="3" y1="3" x2="13" y2="13" />
                <line x1="13" y1="3" x2="3" y2="13" />
              </svg>
            </button>
          </div>
        </div>

        <div className="pedmodal-divider" />

        {/* Body */}
        {loading && <div className="pedmodal-body">Carregando...</div>}
        {error && <div className="pedmodal-body">{error}</div>}
        {data && (
          <div className="pedmodal-body">
            {/* Meta badges */}
            <div className="pedmodal-meta">
              <span className="pedmodal-badge pedmodal-badge--comanda">
                Comanda #{data.pedido.id}
              </span>
              <span
                className={`pedmodal-badge pedmodal-badge--${STATUS_TYPE[data.pedido.status_preparo]}`}
              >
                {STATUS_LABEL[data.pedido.status_preparo]}
              </span>
              <span className="pedmodal-meta-date">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="#8c7a76"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="2" y="3" width="12" height="11" rx="2" />
                  <line x1="2" y1="7" x2="14" y2="7" />
                  <line x1="5" y1="1.5" x2="5" y2="4" />
                  <line x1="11" y1="1.5" x2="11" y2="4" />
                </svg>
                {formatarData(data.pedido.criado_em)} · Retirada
              </span>
            </div>

            {/* Items */}
            <div className="pedmodal-items">
              <span className="pedmodal-section-label">Itens do pedido</span>
              {data.itens.map((item, i) => (
                <div className="pedmodal-item-row" key={i}>
                  <div className="pedmodal-item-info">
                    <span className="pedmodal-item-name">
                      {item.produto_nome} {item.emoji ?? ""}
                    </span>
                    <span className="pedmodal-item-qty">
                      {item.quantidade}x{" "}
                      {formatarPreco(item.valor_unitario_centavos)}
                    </span>
                  </div>
                  <span className="pedmodal-item-price">
                    {formatarPreco(item.valor_total_centavos)}
                  </span>
                </div>
              ))}
            </div>

            {/* Summary */}
            <div className="pedmodal-summary">
              <div className="pedmodal-summary-row">
                <span className="pedmodal-summary-label">Subtotal</span>
                <span className="pedmodal-summary-value">
                  {formatarPreco(data.pedido.valor_total_centavos)}
                </span>
              </div>
              <div className="pedmodal-summary-row pedmodal-summary-row--total">
                <span className="pedmodal-total-label">Total</span>
                <span className="pedmodal-total-value">
                  {formatarPreco(data.pedido.valor_total_centavos)}
                </span>
              </div>
            </div>

            <div className="pedmodal-divider" />

            {/* Payment */}
            <div className="pedmodal-payment">
              <span className="pedmodal-section-label">Pagamento</span>
              <div className="pedmodal-payment-row">
                <span className="pedmodal-badge pedmodal-badge--green">
                  ✓ Pago
                </span>
                <span className="pedmodal-payment-method">Método: Pix</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
