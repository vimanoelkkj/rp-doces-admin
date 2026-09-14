import { createPortal } from "react-dom";
import "./PedidoDetalheModal.css";

/* ── Types ── */
interface OrderItem {
  name: string;
  emoji: string;
  qty: number;
  unitPrice: string;
  totalPrice: string;
}

interface OrderDetail {
  id: string;
  number: number;
  client: string;
  status: string;
  statusType: "green" | "orange" | "blue";
  date: string;
  deliveryType: string;
  items: OrderItem[];
  subtotal: string;
  total: string;
  paymentStatus: string;
  paymentMethod: string;
}

interface PedidoDetalheModalProps {
  order: OrderDetail;
  onClose: () => void;
}

/* ── Mock order (for reference / default) ── */
export const MOCK_ORDER: OrderDetail = {
  id: "RP-33",
  number: 33,
  client: "RP",
  status: "Entregue",
  statusType: "green",
  date: "10/09, 15:14",
  deliveryType: "Retirada",
  items: [
    {
      name: "Ninho & Nutella",
      emoji: "🍫",
      qty: 1,
      unitPrice: "R$ 20,00",
      totalPrice: "R$ 20,00",
    },
    {
      name: "Prestígio cremoso",
      emoji: "🥥",
      qty: 1,
      unitPrice: "R$ 20,00",
      totalPrice: "R$ 20,00",
    },
  ],
  subtotal: "R$ 40,00",
  total: "R$ 40,00",
  paymentStatus: "Pago",
  paymentMethod: "Dinheiro",
};

export type { OrderDetail, OrderItem };

/* ── Component ── */
export default function PedidoDetalheModal({
  order,
  onClose,
}: PedidoDetalheModalProps) {
  return createPortal(
    <div className="pedmodal-overlay" onClick={onClose}>
      <div className="pedmodal-card" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="pedmodal-header">
          <h2 className="pedmodal-title">
            Pedido #{order.number} - {order.client}
          </h2>
          <div className="pedmodal-header-actions">
            <button className="pedmodal-btn-edit">Editar pedido</button>
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
        <div className="pedmodal-body">
          {/* Meta badges */}
          <div className="pedmodal-meta">
            <span className="pedmodal-badge pedmodal-badge--comanda">
              Comanda #{order.number}
            </span>
            <span
              className={`pedmodal-badge pedmodal-badge--${order.statusType}`}
            >
              {order.status}
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
              {order.date} · {order.deliveryType}
            </span>
          </div>

          {/* Items */}
          <div className="pedmodal-items">
            <span className="pedmodal-section-label">Itens do pedido</span>
            {order.items.map((item, i) => (
              <div className="pedmodal-item-row" key={i}>
                <div className="pedmodal-item-info">
                  <span className="pedmodal-item-name">
                    {item.name} {item.emoji}
                  </span>
                  <span className="pedmodal-item-qty">
                    {item.qty}x {item.unitPrice}
                  </span>
                </div>
                <span className="pedmodal-item-price">{item.totalPrice}</span>
              </div>
            ))}
          </div>

          {/* Summary */}
          <div className="pedmodal-summary">
            <div className="pedmodal-summary-row">
              <span className="pedmodal-summary-label">Subtotal</span>
              <span className="pedmodal-summary-value">{order.subtotal}</span>
            </div>
            <div className="pedmodal-summary-row pedmodal-summary-row--total">
              <span className="pedmodal-total-label">Total</span>
              <span className="pedmodal-total-value">{order.total}</span>
            </div>
          </div>

          <div className="pedmodal-divider" />

          {/* Payment */}
          <div className="pedmodal-payment">
            <span className="pedmodal-section-label">Pagamento</span>
            <div className="pedmodal-payment-row">
              <span className="pedmodal-badge pedmodal-badge--green">
                ✓ {order.paymentStatus}
              </span>
              <span className="pedmodal-payment-method">
                Método: {order.paymentMethod}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
