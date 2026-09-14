import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import "./NovoPedidoModal.css";

/* ── Icons ── */
const IconClose = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 18 18"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
  >
    <path d="M4.5 4.5l9 9M13.5 4.5l-9 9" />
  </svg>
);

const IconPlus = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 14 14"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
  >
    <line x1="7" y1="2" x2="7" y2="12" />
    <line x1="2" y1="7" x2="12" y2="7" />
  </svg>
);

const IconChevron = ({ open }: { open: boolean }) => (
  <svg
    width="12"
    height="8"
    viewBox="0 0 12 8"
    fill="none"
    style={{
      transition: "transform 0.15s",
      transform: open ? "rotate(180deg)" : "rotate(0)",
    }}
  >
    <path
      d="M1 1.5L6 6.5L11 1.5"
      stroke="#634738"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const IconRemove = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 14 14"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
  >
    <line x1="3" y1="3" x2="11" y2="11" />
    <line x1="11" y1="3" x2="3" y2="11" />
  </svg>
);

/* ── Types ── */
interface Product {
  name: string;
  emoji: string;
  price: string;
  available: number;
}

interface OrderItem {
  productIndex: number | null;
  qty: number;
}

/* ── Mock data ── */
const PRODUCTS: Product[] = [
  {
    name: "Encanto de frutas vermelhas",
    emoji: "🍓💗",
    price: "R$ 20,00",
    available: 1,
  },
  { name: "Ninho & Nutella", emoji: "🍫💗", price: "R$ 20,00", available: 1 },
  { name: "Prestígio cremoso", emoji: "🥥💗", price: "R$ 20,00", available: 5 },
  {
    name: "Tentação de maracujá",
    emoji: "💛💫",
    price: "R$ 20,00",
    available: 7,
  },
  { name: "Pudim", emoji: "🍮💗", price: "R$ 15,00", available: 11 },
];

const PAYMENT_METHODS = [
  "Pix direto",
  "Dinheiro",
  "Cartão de crédito",
  "Cartão de débito",
];
const PAYMENT_STATUS = ["Aguardando pagamento", "Já pago"];

interface NovoPedidoModalProps {
  open: boolean;
  onClose: () => void;
}

/* ── Custom Dropdown Hook ── */
function useDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return { open, setOpen, ref };
}

/* ── Component ── */
export default function NovoPedidoModal({
  open,
  onClose,
}: NovoPedidoModalProps) {
  const [clientName, setClientName] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [items, setItems] = useState<OrderItem[]>([
    { productIndex: null, qty: 1 },
  ]);
  const [paymentMethod, setPaymentMethod] = useState(PAYMENT_METHODS[0]);
  const [paymentStatus, setPaymentStatus] = useState(PAYMENT_STATUS[0]);
  const [observation, setObservation] = useState("");

  // Dropdowns for payment
  const payMethodDd = useDropdown();
  const payStatusDd = useDropdown();

  const updateItem = (
    index: number,
    field: keyof OrderItem,
    value: number | null,
  ) => {
    setItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, [field]: value } : item)),
    );
  };

  const removeItem = (index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  const addItem = () => {
    setItems((prev) => [...prev, { productIndex: null, qty: 1 }]);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // TODO: integrar com backend
    onClose();
  };

  if (!open) return null;

  return createPortal(
    <div className="nped-overlay" onClick={onClose}>
      <div className="nped-modal" onClick={(e) => e.stopPropagation()}>
        {/* ── Header ── */}
        <div className="nped-header">
          <div>
            <span className="nped-kicker">NOVO PEDIDO</span>
            <h2 className="nped-title">Registrar venda manual</h2>
            <p className="nped-subtitle">
              Balcão, WhatsApp, boca a boca ou pedido feito fora do site.
            </p>
          </div>
          <button className="nped-close" onClick={onClose}>
            <IconClose />
          </button>
        </div>

        <div className="nped-divider" />

        {/* ── Form ── */}
        <form className="nped-body" onSubmit={handleSubmit}>
          {/* Cliente + WhatsApp */}
          <div className="nped-row-2">
            <div className="nped-field">
              <label>
                Cliente <span className="nped-optional">opcional</span>
              </label>
              <input
                type="text"
                placeholder="Nome do cliente"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
              />
            </div>
            <div className="nped-field">
              <label>
                WhatsApp <span className="nped-optional">opcional</span>
              </label>
              <input
                type="text"
                placeholder="(31) 99999-9999"
                value={whatsapp}
                onChange={(e) => setWhatsapp(e.target.value)}
              />
            </div>
          </div>

          {/* Itens */}
          <div className="nped-items-card">
            <div className="nped-items-header">
              <div>
                <span className="nped-items-title">Itens</span>
                <span className="nped-items-hint">
                  O estoque será reservado ao salvar.
                </span>
              </div>
              <button
                type="button"
                className="nped-btn-add-item"
                onClick={addItem}
              >
                <IconPlus /> Adicionar item
              </button>
            </div>

            {items.map((item, i) => (
              <ProductItemRow
                key={i}
                item={item}
                onChangeProduct={(idx) => updateItem(i, "productIndex", idx)}
                onChangeQty={(qty) => updateItem(i, "qty", qty)}
                onRemove={() => removeItem(i)}
                canRemove={items.length > 1}
              />
            ))}
          </div>

          {/* Pagamento */}
          <div className="nped-row-2">
            <div className="nped-field">
              <label>Forma de pagamento</label>
              <div
                className={`nped-dropdown ${payMethodDd.open ? "nped-dropdown--open" : ""}`}
                ref={payMethodDd.ref}
              >
                <button
                  type="button"
                  className="nped-dropdown-trigger"
                  onClick={() => payMethodDd.setOpen(!payMethodDd.open)}
                >
                  <span>{paymentMethod}</span>
                  <IconChevron open={payMethodDd.open} />
                </button>
                {payMethodDd.open && (
                  <ul className="nped-dropdown-list">
                    {PAYMENT_METHODS.map((m) => (
                      <li key={m}>
                        <button
                          type="button"
                          className={`nped-dropdown-option ${paymentMethod === m ? "nped-dropdown-option--active" : ""}`}
                          onClick={() => {
                            setPaymentMethod(m);
                            payMethodDd.setOpen(false);
                          }}
                        >
                          {m}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div className="nped-field">
              <label>Situação do pagamento</label>
              <div
                className={`nped-dropdown ${payStatusDd.open ? "nped-dropdown--open" : ""}`}
                ref={payStatusDd.ref}
              >
                <button
                  type="button"
                  className="nped-dropdown-trigger"
                  onClick={() => payStatusDd.setOpen(!payStatusDd.open)}
                >
                  <span>{paymentStatus}</span>
                  <IconChevron open={payStatusDd.open} />
                </button>
                {payStatusDd.open && (
                  <ul className="nped-dropdown-list">
                    {PAYMENT_STATUS.map((s) => (
                      <li key={s}>
                        <button
                          type="button"
                          className={`nped-dropdown-option ${paymentStatus === s ? "nped-dropdown-option--active" : ""}`}
                          onClick={() => {
                            setPaymentStatus(s);
                            payStatusDd.setOpen(false);
                          }}
                        >
                          {s}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>

          {/* Observação */}
          <div className="nped-field">
            <label>
              Observação <span className="nped-optional">opcional</span>
            </label>
            <textarea
              placeholder="Ex.: buscar amanhã às 15h"
              value={observation}
              onChange={(e) => setObservation(e.target.value)}
              rows={3}
            />
          </div>

          {/* Footer */}
          <div className="nped-footer">
            <button type="button" className="nped-btn-cancel" onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="nped-btn-save">
              Registrar pedido
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}

/* ── Product Item Row (sub-component) ── */
interface ProductItemRowProps {
  item: OrderItem;
  onChangeProduct: (index: number | null) => void;
  onChangeQty: (qty: number) => void;
  onRemove: () => void;
  canRemove: boolean;
}

function ProductItemRow({
  item,
  onChangeProduct,
  onChangeQty,
  onRemove,
  canRemove,
}: ProductItemRowProps) {
  const dd = useDropdown();
  const selected =
    item.productIndex !== null ? PRODUCTS[item.productIndex] : null;

  const formatProduct = (p: Product) =>
    `${p.name} ${p.emoji} · ${p.price} · ${p.available} disp.`;

  return (
    <div className="nped-item-row">
      <div className="nped-item-row-labels">
        <span className="nped-item-label nped-item-label--product">
          Produto
        </span>
        <span className="nped-item-label nped-item-label--qty">Qtd.</span>
      </div>
      <div className="nped-item-row-fields">
        {/* Product dropdown */}
        <div
          className={`nped-dropdown nped-dropdown--product ${dd.open ? "nped-dropdown--open" : ""}`}
          ref={dd.ref}
        >
          <button
            type="button"
            className="nped-dropdown-trigger"
            onClick={() => dd.setOpen(!dd.open)}
          >
            <span className={selected ? "" : "nped-placeholder"}>
              {selected ? formatProduct(selected) : "Selecionar produto..."}
            </span>
            <IconChevron open={dd.open} />
          </button>
          {dd.open && (
            <ul className="nped-dropdown-list nped-dropdown-list--products">
              {PRODUCTS.map((p, i) => (
                <li key={i}>
                  <button
                    type="button"
                    className={`nped-dropdown-option ${item.productIndex === i ? "nped-dropdown-option--active" : ""}`}
                    onClick={() => {
                      onChangeProduct(i);
                      dd.setOpen(false);
                    }}
                  >
                    {formatProduct(p)}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Qty */}
        <input
          type="number"
          className="nped-qty-input"
          min={1}
          value={item.qty}
          onChange={(e) =>
            onChangeQty(Math.max(1, parseInt(e.target.value) || 1))
          }
        />

        {/* Remove */}
        <button
          type="button"
          className="nped-btn-remove"
          onClick={onRemove}
          disabled={!canRemove}
        >
          <IconRemove />
        </button>
      </div>
    </div>
  );
}
