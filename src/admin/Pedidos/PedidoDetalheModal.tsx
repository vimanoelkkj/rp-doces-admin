import { useEffect, useRef, useState } from "react";
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

type StatusPedido = "NOVO" | "PREPARANDO" | "PRONTO" | "ENTREGUE" | "CANCELADO";

interface PedidoRow {
  id: number;
  cliente_nome: string;
  cliente_whatsapp: string;
  observacao: string;
  valor_total_centavos: number;
  status_pagamento: string;
  status_pedido: StatusPedido;
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

// Mesmo enum de produção (order.model.ts / OrderStatusSelect.tsx) — o admin
// pode escolher qualquer status livremente, sem avanço linear forçado.
const STATUS_PEDIDO_OPCOES: StatusPedido[] = [
  "NOVO",
  "PREPARANDO",
  "PRONTO",
  "ENTREGUE",
  "CANCELADO",
];

const STATUS_LABEL: Record<StatusPedido, string> = {
  NOVO: "Novo",
  PREPARANDO: "Em produção",
  PRONTO: "Pronto",
  ENTREGUE: "Entregue",
  CANCELADO: "Cancelado",
};

const STATUS_TYPE: Record<StatusPedido, "green" | "orange" | "blue" | "red"> = {
  NOVO: "orange",
  PREPARANDO: "orange",
  PRONTO: "blue",
  ENTREGUE: "green",
  CANCELADO: "red",
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
  const [alterando, setAlterando] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const statusMenuRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (!statusMenuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (
        statusMenuRef.current &&
        !statusMenuRef.current.contains(e.target as Node)
      ) {
        setStatusMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [statusMenuOpen]);

  const alterarStatus = (novoStatus: StatusPedido) => {
    setStatusMenuOpen(false);
    if (!data || novoStatus === data.pedido.status_pedido) return;

    setAlterando(true);
    setStatusError(null);
    fetch(`/api/admin/pedidos/${orderId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ statusPedido: novoStatus }),
    })
      .then(async (response) => {
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.error ?? "Falha ao alterar status");
        }
        setData((prev) =>
          prev
            ? { ...prev, pedido: { ...prev.pedido, status_pedido: novoStatus } }
            : prev,
        );
        onStatusChanged?.();
      })
      .catch((err) => setStatusError(err.message))
      .finally(() => setAlterando(false));
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
            {data && (
              <div className="pedmodal-status-dropdown" ref={statusMenuRef}>
                <button
                  type="button"
                  className="pedmodal-btn-advance"
                  onClick={() => setStatusMenuOpen((open) => !open)}
                  disabled={alterando}
                >
                  Alterar status
                </button>
                {statusMenuOpen && (
                  <ul className="pedmodal-status-menu">
                    {STATUS_PEDIDO_OPCOES.map((status) => (
                      <li key={status}>
                        <button
                          type="button"
                          className={`pedmodal-status-option${
                            status === data.pedido.status_pedido
                              ? " pedmodal-status-option--current"
                              : ""
                          }${status === "CANCELADO" ? " pedmodal-status-option--danger" : ""}`}
                          onClick={() => alterarStatus(status)}
                        >
                          {STATUS_LABEL[status]}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {data && data.pedido.status_pedido !== "ENTREGUE" && (
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
            {statusError && (
              <p className="pedmodal-status-error">{statusError}</p>
            )}
            {/* Meta badges */}
            <div className="pedmodal-meta">
              <span className="pedmodal-badge pedmodal-badge--comanda">
                Comanda #{data.pedido.id}
              </span>
              <span
                className={`pedmodal-badge pedmodal-badge--${STATUS_TYPE[data.pedido.status_pedido]}`}
              >
                {STATUS_LABEL[data.pedido.status_pedido]}
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
