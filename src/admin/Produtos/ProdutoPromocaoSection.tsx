import { formatBrlInput, parseBrlInputToCents } from "../../lib/brl";
import { calcularPromoEstadoEHint } from "./novoProdutoHelpers";

interface ProdutoPromocaoSectionProps {
  fieldId: string;
  price: string;
  promoPrice: string;
  setPromoPrice: (val: string) => void;
  promoInicio: string;
  setPromoInicio: (val: string) => void;
  promoFim: string;
  setPromoFim: (val: string) => void;
}

export default function ProdutoPromocaoSection({
  fieldId,
  price,
  promoPrice,
  setPromoPrice,
  promoInicio,
  setPromoInicio,
  promoFim,
  setPromoFim
}: ProdutoPromocaoSectionProps) {
  const precoCentavos = parseBrlInputToCents(price);
  const { promoHint } = calcularPromoEstadoEHint(
    precoCentavos,
    promoPrice,
    true,
    promoInicio,
    promoFim
  );

  return (
    <div className="np-promo-box np-field--full">
      <div className="np-field np-field--full">
        <label htmlFor={`${fieldId}-preco-promocional`}>PREÇO PROMOCIONAL</label>
        <input
          id={`${fieldId}-preco-promocional`}
          type="text"
          placeholder="0,00"
          value={promoPrice}
          onChange={e => setPromoPrice(formatBrlInput(e.target.value))}
          inputMode="decimal"
        />
      </div>

      <div className="np-row-2">
        <div className="np-field">
          <label htmlFor={`${fieldId}-promocao-inicio`}>INÍCIO — OPCIONAL</label>
          <input
            id={`${fieldId}-promocao-inicio`}
            type="datetime-local"
            value={promoInicio}
            onChange={e => setPromoInicio(e.target.value)}
          />
        </div>
        <div className="np-field">
          <label htmlFor={`${fieldId}-promocao-fim`}>TÉRMINO — OPCIONAL</label>
          <input
            id={`${fieldId}-promocao-fim`}
            type="datetime-local"
            value={promoFim}
            onChange={e => setPromoFim(e.target.value)}
          />
        </div>
      </div>

      <p className="np-promo-hint">{promoHint}</p>
    </div>
  );
}
