import { formatPrice } from "./cartWidgetHelpers";

interface CartFooterProps {
  totalPrice: number;
  onCheckout: () => void;
  onClose: () => void;
}

export default function CartFooter({ totalPrice, onCheckout, onClose }: CartFooterProps) {
  return (
    <div className="cart-modal-footer">
      <div className="cart-total">
        <span>TOTAL</span>
        <span className="cart-total-value">{formatPrice(totalPrice)}</span>
      </div>
      <p className="cart-notice">
        Os pedidos do cardápio do dia devem ser retirados diretamente em nosso salão parceiro,
        Tempori Concept no Cambuí.
      </p>
      <button
        type="button"
        className="cart-checkout-btn"
        onClick={e => {
          e.currentTarget.blur();
          onCheckout();
        }}
      >
        CONTINUAR PARA PAGAMENTO
      </button>
      <button
        type="button"
        className="cart-continue-btn"
        onClick={e => {
          e.currentTarget.blur();
          onClose();
        }}
      >
        Continuar comprando
      </button>
    </div>
  );
}
