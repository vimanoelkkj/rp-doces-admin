import type { Dispatch, SetStateAction } from "react";
import { precoVigenteCentavos } from "../../../shared/promocao";
import type { ProdutoAdmin } from "../Produtos/AdminProdutos";
import { free, money, type Item, type Preview } from "./trocarItemHelpers";

interface Props {
  item: Item;
  products: ProdutoAdmin[];
  productId: number | null;
  quantity: number;
  action: string;
  preview: Preview | null;
  saving: boolean;
  disabled: boolean;
  productDropdownOpen: boolean;
  actionDropdownOpen: boolean;
  setProductId: Dispatch<SetStateAction<number | null>>;
  setQuantity: Dispatch<SetStateAction<number>>;
  setAction: Dispatch<SetStateAction<string>>;
  setProductDropdownOpen: Dispatch<SetStateAction<boolean>>;
  setActionDropdownOpen: Dispatch<SetStateAction<boolean>>;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

export default function TrocarItemFormSection({
  item,
  products,
  productId,
  quantity,
  action,
  preview,
  saving,
  disabled,
  productDropdownOpen,
  actionDropdownOpen,
  setProductId,
  setQuantity,
  setAction,
  setProductDropdownOpen,
  setActionDropdownOpen,
  onClose,
  onConfirm
}: Props) {
  return (
    <div className="additem-form">
      <label className="additem-field">
        <span>Novo produto</span>
        <div className={`additem-dropdown${productDropdownOpen ? " additem-dropdown--open" : ""}`}>
          <button
            type="button"
            className="additem-dropdown-trigger"
            onClick={() => setProductDropdownOpen(open => !open)}
            onBlur={() => setTimeout(() => setProductDropdownOpen(false), 150)}
          >
            <span>
              {(() => {
                const selected = products.find(p => p.id === productId);
                return selected
                  ? `${selected.nome} · ${money(precoVigenteCentavos(selected))} · ${free(selected)} disponíveis`
                  : "Selecione";
              })()}
            </span>
            <svg aria-hidden="true" width="12" height="8" viewBox="0 0 12 8" fill="none">
              <path
                d="M1 1.5L6 6.5L11 1.5"
                stroke="#634738"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          {productDropdownOpen && (
            <ul className="additem-dropdown-list">
              {products.map(p => (
                <li key={p.id}>
                  <button
                    type="button"
                    className={`additem-dropdown-option${productId === p.id ? " additem-dropdown-option--active" : ""}`}
                    onClick={() => {
                      setProductId(p.id);
                      setQuantity(1);
                      setProductDropdownOpen(false);
                    }}
                  >
                    {p.nome} · {money(precoVigenteCentavos(p))} · {free(p)} disponíveis
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </label>
      <label className="additem-field">
        <span>Quantidade</span>
        <input
          type="number"
          min="1"
          max="50"
          value={quantity}
          onChange={e => setQuantity(Number(e.target.value))}
        />
      </label>
      {item.estoque_estado === "BAIXADO" && (
        <label className="additem-field">
          <span>Produto atual</span>
          <div className={`additem-dropdown${actionDropdownOpen ? " additem-dropdown--open" : ""}`}>
            <button
              type="button"
              className="additem-dropdown-trigger"
              onClick={() => setActionDropdownOpen(open => !open)}
              onBlur={() => setTimeout(() => setActionDropdownOpen(false), 150)}
            >
              <span>
                {action === "REPOR" ? "Voltou fisicamente ao estoque" : "Não voltou ao estoque"}
              </span>
              <svg aria-hidden="true" width="12" height="8" viewBox="0 0 12 8" fill="none">
                <path
                  d="M1 1.5L6 6.5L11 1.5"
                  stroke="#634738"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            {actionDropdownOpen && (
              <ul className="additem-dropdown-list">
                {[
                  { value: "NAO_REPOR", label: "Não voltou ao estoque" },
                  { value: "REPOR", label: "Voltou fisicamente ao estoque" }
                ].map(option => (
                  <li key={option.value}>
                    <button
                      type="button"
                      className={`additem-dropdown-option${action === option.value ? " additem-dropdown-option--active" : ""}`}
                      onClick={() => {
                        setAction(option.value);
                        setActionDropdownOpen(false);
                      }}
                    >
                      {option.label}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </label>
      )}
      {preview && (
        <>
          <div className="cancelpreview-values">
            <div>
              <span>Valor atual</span>
              <strong>{money(item.valor_total_centavos)}</strong>
            </div>
            <div>
              <span>Novo valor</span>
              <strong>{money(preview.itemDestino.valorCentavos)}</strong>
            </div>
            <div>
              <span>Diferença</span>
              <strong>
                {preview.financeiro.diferencaCentavos > 0
                  ? "+ "
                  : preview.financeiro.diferencaCentavos < 0
                    ? "- "
                    : ""}
                {money(Math.abs(preview.financeiro.diferencaCentavos))}
              </strong>
            </div>
            <div>
              <span>Saldo após troca</span>
              <strong>{money(preview.financeiro.saldoProjetadoCentavos)}</strong>
            </div>
            {preview.financeiro.excessoProjetadoCentavos > 0 && (
              <div>
                <span>Será necessário devolver</span>
                <strong>{money(preview.financeiro.excessoProjetadoCentavos)}</strong>
              </div>
            )}
          </div>
          {preview.bloqueios.map(b => (
            <div className="cancelpreview-block" key={b.codigo}>
              {b.mensagem}
            </div>
          ))}
        </>
      )}
      <footer className="additem-actions">
        <button type="button" className="additem-cancel" onClick={onClose}>
          Voltar
        </button>
        <button
          type="button"
          className="additem-confirm"
          onClick={() => void onConfirm()}
          disabled={disabled}
        >
          {saving ? "Confirmando..." : "Confirmar troca"}
        </button>
      </footer>
    </div>
  );
}
