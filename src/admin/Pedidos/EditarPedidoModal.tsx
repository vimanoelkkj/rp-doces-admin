import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ProdutoAdmin } from "../Produtos/AdminProdutos";
import PortalDropdown from "../components/PortalDropdown";
import { useAdminModal } from "../components/useAdminModal";
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
interface EditItem {
  produtoId: number | null;
  quantidade: number;
}

interface PedidoItemRow {
  produto_id: number | null;
  produto_nome: string;
  quantidade: number;
}

interface PedidoDetalheResponse {
  pedido: { id: number; status_pedido: string };
  itens: PedidoItemRow[];
}

interface EditarPedidoModalProps {
  orderId: number;
  onClose: () => void;
}

const formatarPreco = (centavos: number) =>
  `R$ ${(centavos / 100).toFixed(2).replace(".", ",")}`;

/* ── Custom Dropdown Hook (mesmo padrão do NovoPedidoModal) ── */
function useDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (
        ref.current &&
        !ref.current.contains(e.target as Node) &&
        !menuRef.current?.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return { open, setOpen, ref, menuRef };
}

/* ── Component ── */
export default function EditarPedidoModal({
  orderId,
  onClose,
}: EditarPedidoModalProps) {
  const [produtos, setProdutos] = useState<ProdutoAdmin[]>([]);
  const [items, setItems] = useState<EditItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const modalProps = useAdminModal(true, onClose);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch(`/api/admin/pedidos/${orderId}`).then(async (r) => {
        if (!r.ok) throw new Error("Falha ao carregar pedido");
        return r.json() as Promise<PedidoDetalheResponse>;
      }),
      fetch("/api/admin/produtos").then(async (r) => {
        if (!r.ok) throw new Error("Falha ao carregar produtos");
        return r.json() as Promise<{ produtos: ProdutoAdmin[] }>;
      }),
    ])
      .then(([detalhe, catalogo]) => {
        setProdutos(catalogo.produtos);
        setItems(
          detalhe.itens.map((item) => ({
            produtoId: item.produto_id,
            quantidade: item.quantidade,
          })),
        );
        setError(null);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [orderId]);

  const updateItem = (index: number, field: keyof EditItem, value: number | null) => {
    setItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, [field]: value } : item)),
    );
  };

  const removeItem = (index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  const addItem = () => {
    setItems((prev) => [...prev, { produtoId: null, quantidade: 1 }]);
  };

  const produtoPorId = new Map(produtos.map((p) => [p.id, p]));
  const totalCentavos = items.reduce((soma, item) => {
    const produto = item.produtoId ? produtoPorId.get(item.produtoId) : null;
    return soma + (produto ? produto.preco_centavos * item.quantidade : 0);
  }, 0);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("A edição de itens está temporariamente indisponível. Nenhuma alteração foi salva.");
  };

  return createPortal(
    <div className="nped-overlay" {...modalProps}>
      <div className="nped-modal">
        {/* ── Header ── */}
        <div className="nped-header">
          <div>
            <span className="nped-kicker">COMANDA #{orderId}</span>
            <h2 className="nped-title">Editar pedido</h2>
            <p className="nped-subtitle">
              Adicione ou remova produtos desta comanda.
            </p>
          </div>
          <button className="nped-close" onClick={onClose}>
            <IconClose />
          </button>
        </div>

        <div className="nped-divider" />

        {loading && <div className="nped-body">Carregando...</div>}

        {!loading && (
          <form className="nped-body" onSubmit={handleSubmit}>
            {error && <p className="nped-error">{error}</p>}
            <p className="nped-blocked-notice">
              A edição de itens está temporariamente indisponível. Os itens abaixo são somente para consulta.
            </p>

            <div className="nped-items-card">
              <div className="nped-items-header">
                <div>
                  <span className="nped-items-title">Itens</span>
                  <span className="nped-items-hint">
                    Total atual: {formatarPreco(totalCentavos)}
                  </span>
                </div>
                <button
                  type="button"
                  className="nped-btn-add-item"
                  onClick={addItem}
                  disabled
                >
                  <IconPlus /> Adicionar item
                </button>
              </div>

              {items.map((item, i) => (
                <ProductItemRow
                  key={i}
                  item={item}
                  produtos={produtos}
                  onChangeProduct={(idx) => updateItem(i, "produtoId", idx)}
                  onChangeQty={(qty) => updateItem(i, "quantidade", qty)}
                  onRemove={() => removeItem(i)}
                  canRemove={items.length > 1}
                  disabled
                />
              ))}
            </div>

            <div className="nped-footer">
              <button
                type="button"
                className="nped-btn-cancel"
                onClick={onClose}
              >
                Cancelar
              </button>
              <button type="submit" className="nped-btn-save" disabled>
                Salvar alterações
              </button>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body,
  );
}

/* ── Product Item Row (sub-component) ── */
interface ProductItemRowProps {
  item: EditItem;
  produtos: ProdutoAdmin[];
  onChangeProduct: (id: number | null) => void;
  onChangeQty: (qty: number) => void;
  onRemove: () => void;
  canRemove: boolean;
  disabled: boolean;
}

function ProductItemRow({
  item,
  produtos,
  onChangeProduct,
  onChangeQty,
  onRemove,
  canRemove,
  disabled,
}: ProductItemRowProps) {
  const dd = useDropdown();
  const selected = item.produtoId
    ? produtos.find((p) => p.id === item.produtoId)
    : null;

  const formatProduct = (p: ProdutoAdmin) =>
    `${p.nome} ${p.emoji} · ${formatarPreco(p.preco_centavos)} · ${p.estoque} disp.`;

  return (
    <div className="nped-item-row">
      <div className="nped-item-row-labels">
        <span className="nped-item-label nped-item-label--product">
          Produto
        </span>
        <span className="nped-item-label nped-item-label--qty">Qtd.</span>
      </div>
      <div className="nped-item-row-fields">
        <div
          className={`nped-dropdown nped-dropdown--product ${dd.open ? "nped-dropdown--open" : ""}`}
          ref={dd.ref}
        >
          <button
            type="button"
            className="nped-dropdown-trigger"
            onClick={() => !disabled && dd.setOpen(!dd.open)}
            disabled={disabled}
          >
            <span className={selected ? "" : "nped-placeholder"}>
              {selected ? formatProduct(selected) : "Selecionar produto..."}
            </span>
            <IconChevron open={dd.open} />
          </button>
          <PortalDropdown
            open={dd.open}
            anchorRef={dd.ref}
            menuRef={dd.menuRef}
            className="nped-dropdown-list nped-dropdown-list--products"
          >
              {produtos.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className={`nped-dropdown-option ${item.produtoId === p.id ? "nped-dropdown-option--active" : ""}`}
                    onClick={() => {
                      onChangeProduct(p.id);
                      dd.setOpen(false);
                    }}
                  >
                    {formatProduct(p)}
                  </button>
                </li>
              ))}
          </PortalDropdown>
        </div>

        <input
          type="number"
          className="nped-qty-input"
          min={1}
          value={item.quantidade}
          disabled={disabled}
          onChange={(e) =>
            onChangeQty(Math.max(1, parseInt(e.target.value) || 1))
          }
        />

        <button
          type="button"
          className="nped-btn-remove"
          onClick={onRemove}
          disabled={disabled || !canRemove}
        >
          <IconRemove />
        </button>
      </div>
    </div>
  );
}
