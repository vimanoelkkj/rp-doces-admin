import type { ProdutoAdmin } from "../Produtos/AdminProdutos";
import PortalDropdown from "../components/PortalDropdown";
import { useDropdown } from "../components/useDropdown";
import { IconRemove } from "../components/AdminIcons";
import {
  formatarPreco,
  estoqueLivre,
  type ProductItemRowProps
} from "./novoPedidoHelpers";

export const IconChevron = ({ open }: { open: boolean }) => (
  <svg
    aria-hidden="true"
    width="12"
    height="8"
    viewBox="0 0 12 8"
    fill="none"
    style={{
      transition: "transform 0.15s",
      transform: open ? "rotate(180deg)" : "rotate(0)"
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

export default function ProductItemRow({
  item,
  produtos,
  onChangeProduct,
  onChangeQty,
  onRemove,
  canRemove
}: ProductItemRowProps) {
  const dd = useDropdown();
  const selected = item.produtoId ? produtos.find(p => p.id === item.produtoId) : null;

  const formatProduct = (p: ProdutoAdmin) =>
    `${p.nome} ${p.emoji} · ${formatarPreco(p.preco_centavos)} · ${estoqueLivre(p)} disp.`;

  return (
    <div className="nped-item-row">
      <div className="nped-item-row-labels">
        <span className="nped-item-label nped-item-label--product">Produto</span>
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
          <PortalDropdown
            open={dd.open}
            anchorRef={dd.ref}
            menuRef={dd.menuRef}
            className="nped-dropdown-list nped-dropdown-list--products"
          >
            {produtos.length === 0 && (
              <li>
                <div className="nped-dropdown-option nped-placeholder">
                  Nenhum produto disponível
                </div>
              </li>
            )}
            {produtos.map(p => (
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

        {/* Qty */}
        <input
          type="number"
          className="nped-qty-input"
          min={1}
          max={selected ? estoqueLivre(selected) : undefined}
          value={item.quantidade}
          onChange={e => {
            const parsed = Math.max(1, parseInt(e.target.value, 10) || 1);
            const limite = selected ? estoqueLivre(selected) : parsed;
            onChangeQty(Math.min(parsed, limite || 1));
          }}
        />

        {/* Remove */}
        <button
          type="button"
          className="nped-btn-remove"
          aria-label="Remover item do pedido"
          onClick={onRemove}
          disabled={!canRemove}
        >
          <IconRemove />
        </button>
      </div>
    </div>
  );
}

