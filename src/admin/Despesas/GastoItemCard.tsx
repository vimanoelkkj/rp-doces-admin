import { useDropdown } from "../components/useDropdown";
import {
  DESPESA_CATEGORIAS,
  DESPESA_CATEGORIA_LABEL,
  DESPESA_UNIDADES,
  DESPESA_UNIDADE_LABEL
} from "../../../shared/despesas";
import { formatarPreco } from "./formatarDespesas";
import { type ItemForm, subtotalItem } from "./gastoModalHelpers";

function IconChevron({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      width="12"
      height="8"
      viewBox="0 0 12 8"
      fill="none"
      className="gasto-dropdown-chevron"
      style={{ transition: "transform 0.15s", transform: open ? "rotate(180deg)" : "rotate(0)" }}
    >
      <path
        d="M1 1.5L6 6.5L11 1.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function GastoDropdown<T extends string>({
  id,
  value,
  options,
  labels,
  disabled,
  onChange,
  ariaLabel
}: {
  id: string;
  value: T;
  options: readonly T[];
  labels: Record<T, string>;
  disabled?: boolean;
  onChange: (valor: T) => void;
  ariaLabel: string;
}) {
  const dd = useDropdown();
  return (
    <div className={`gasto-dropdown ${dd.open ? "gasto-dropdown--open" : ""}`} ref={dd.ref}>
      <button
        id={id}
        type="button"
        className="gasto-dropdown-trigger"
        disabled={disabled}
        aria-label={`${ariaLabel}: ${labels[value]}`}
        onClick={() => dd.setOpen(!dd.open)}
      >
        <span>{labels[value]}</span>
        <IconChevron open={dd.open} />
      </button>
      {dd.open && (
        <ul className="gasto-dropdown-list" ref={dd.menuRef}>
          {options.map(opt => (
            <li key={opt}>
              <button
                type="button"
                className={`gasto-dropdown-option ${value === opt ? "gasto-dropdown-option--active" : ""}`}
                onClick={() => {
                  onChange(opt);
                  dd.setOpen(false);
                }}
              >
                {labels[opt]}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface GastoItemCardProps {
  item: ItemForm;
  index: number;
  totalItens: number;
  fieldId: string;
  salvando: boolean;
  onRemoverItem: (key: string) => void;
  onAtualizarItem: (key: string, campo: keyof ItemForm, valor: string) => void;
}

export default function GastoItemCard({
  item,
  index,
  totalItens,
  fieldId,
  salvando,
  onRemoverItem,
  onAtualizarItem
}: GastoItemCardProps) {
  const subtotal = subtotalItem(item);

  return (
    <article className="gasto-item-card">
      <header>
        <strong>Item {index + 1}</strong>
        <button
          type="button"
          onClick={() => onRemoverItem(item.key)}
          disabled={salvando || totalItens <= 1}
          aria-label={`Remover item ${index + 1}`}
        >
          <svg
            aria-hidden="true"
            width="15"
            height="15"
            viewBox="0 0 15 15"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          >
            <path d="M2 4h11M6 4V2.5h3V4M3.5 4l.6 8.5h6.8l.6-8.5" />
          </svg>
        </button>
      </header>
      <div className="gasto-item-grid">
        <label className="gasto-item-descricao">
          <span>Descrição</span>
          <input
            value={item.descricao}
            disabled={salvando}
            list="gasto-descricoes-conhecidas"
            onChange={e => onAtualizarItem(item.key, "descricao", e.target.value)}
            maxLength={200}
            required
          />
        </label>
        <label htmlFor={`${fieldId}-categoria-${item.key}`}>
          <span>Categoria</span>
          <GastoDropdown
            id={`${fieldId}-categoria-${item.key}`}
            value={item.categoria}
            options={DESPESA_CATEGORIAS}
            labels={DESPESA_CATEGORIA_LABEL}
            disabled={salvando}
            ariaLabel="Categoria"
            onChange={valor => onAtualizarItem(item.key, "categoria", valor)}
          />
        </label>
        <label>
          <span>Quantidade</span>
          <input
            inputMode="decimal"
            value={item.quantidade}
            disabled={salvando}
            onChange={e => onAtualizarItem(item.key, "quantidade", e.target.value)}
            required
          />
        </label>
        <label htmlFor={`${fieldId}-unidade-${item.key}`}>
          <span>Unidade</span>
          <GastoDropdown
            id={`${fieldId}-unidade-${item.key}`}
            value={item.unidade}
            options={DESPESA_UNIDADES}
            labels={DESPESA_UNIDADE_LABEL}
            disabled={salvando}
            ariaLabel="Unidade"
            onChange={valor => onAtualizarItem(item.key, "unidade", valor)}
          />
        </label>
        <label>
          <span>Valor unitário</span>
          <div className="gasto-money-input">
            <span>R$</span>
            <input
              inputMode="decimal"
              value={item.valorUnitario}
              disabled={salvando}
              onChange={e => onAtualizarItem(item.key, "valorUnitario", e.target.value)}
              required
            />
          </div>
        </label>
        <div className="gasto-item-subtotal">
          <span>Total</span>
          <strong>{subtotal === null ? "—" : formatarPreco(subtotal)}</strong>
        </div>
      </div>
    </article>
  );
}

