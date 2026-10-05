import { useState } from "react";
import type { Categoria } from "./novoProdutoHelpers";

const IconMinus = () => (
  <svg
    aria-hidden="true"
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
  >
    <path d="M4 8h8" />
  </svg>
);

const IconPlus = () => (
  <svg
    aria-hidden="true"
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
  >
    <path d="M8 4v8M4 8h8" />
  </svg>
);

interface ProdutoClassificacaoRowProps {
  fieldId: string;
  category: string;
  categorias: Categoria[];
  onSelectCategory: (id: string) => void;
  stock: string;
  onChangeStock: (stock: string) => void;
  isEdit: boolean;
  stockMetrics: {
    estoqueReservado: number;
    estoqueLivre: number;
    estoqueAbaixoDaReserva: boolean;
  };
}

export default function ProdutoClassificacaoRow({
  fieldId,
  category,
  categorias,
  onSelectCategory,
  stock,
  onChangeStock,
  isEdit,
  stockMetrics
}: ProdutoClassificacaoRowProps) {
  const [catOpen, setCatOpen] = useState(false);
  const categoriaSelecionada = categorias.find(c => c.id === category);

  return (
    <div className="np-row-2">
      <div className="np-field">
        <label id={`${fieldId}-categoria-label`} htmlFor={`${fieldId}-categoria`}>
          CATEGORIA
        </label>
        <div className={`np-dropdown ${catOpen ? "np-dropdown--open" : ""}`}>
          <button
            id={`${fieldId}-categoria`}
            type="button"
            className="np-dropdown-trigger"
            aria-labelledby={`${fieldId}-categoria-label ${fieldId}-categoria-value`}
            onClick={() => setCatOpen(!catOpen)}
            onBlur={() => setTimeout(() => setCatOpen(false), 150)}
          >
            <span id={`${fieldId}-categoria-value`}>
              {categoriaSelecionada
                ? `${categoriaSelecionada.emoji} ${categoriaSelecionada.nome}`
                : "Selecione uma categoria"}
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
          {catOpen && (
            <ul className="np-dropdown-list">
              {categorias
                .filter(cat => cat.ativo === 1 || cat.id === category)
                .map(cat => (
                  <li key={cat.id}>
                    <button
                      type="button"
                      className={`np-dropdown-option ${category === cat.id ? "np-dropdown-option--active" : ""}`}
                      onClick={() => {
                        onSelectCategory(cat.id);
                        setCatOpen(false);
                      }}
                    >
                      {cat.emoji} {cat.nome}
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </div>
      </div>

      <div className="np-field">
        <label htmlFor={`${fieldId}-estoque`}>ESTOQUE</label>
        <div className="np-stepper">
          <button
            type="button"
            className="np-stepper-btn"
            aria-label="Diminuir estoque"
            onClick={() => onChangeStock(String(Math.max(0, Number(stock || 0) - 1)))}
          >
            <IconMinus />
          </button>
          <input
            id={`${fieldId}-estoque`}
            type="text"
            className="np-stepper-value"
            value={stock}
            inputMode="numeric"
            aria-label="Estoque total"
            onChange={e => {
              if (/^\d*$/.test(e.target.value)) onChangeStock(e.target.value);
            }}
          />
          <button
            type="button"
            className="np-stepper-btn"
            aria-label="Aumentar estoque"
            onClick={() => onChangeStock(String(Number(stock || 0) + 1))}
          >
            <IconPlus />
          </button>
        </div>
        {isEdit && (
          <div
            className={`np-stock-breakdown${stockMetrics.estoqueAbaixoDaReserva ? " np-stock-breakdown--warning" : ""}`}
            aria-live="polite"
          >
            <span>
              <strong>{stockMetrics.estoqueReservado}</strong>{" "}
              {stockMetrics.estoqueReservado === 1 ? "reservado" : "reservados"}
            </span>
            <span className="np-stock-breakdown-dot" aria-hidden="true" />
            <span>
              <strong>{stockMetrics.estoqueLivre}</strong>{" "}
              {stockMetrics.estoqueLivre === 1 ? "disponível" : "disponíveis"} para venda
            </span>
            {stockMetrics.estoqueAbaixoDaReserva && (
              <small>O estoque total ficou abaixo da quantidade já reservada.</small>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
