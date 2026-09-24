import type { PedidoItemRow, StatusPedido } from "./types";
import {
  FLOW_STATUS_LABEL,
  ITEM_STATUS_LABEL,
  STOCK_STATUS_LABEL,
  formatarPreco,
} from "./helpers";

interface PedidoItensProps {
  itens: PedidoItemRow[];
  valorTotalCentavos: number;
  anulado: boolean;
  arquivado: boolean;
  origemPedido: "SITE" | "MANUAL";
  statusComanda: string;
  statusPedido: StatusPedido;
  onAbrirHistorico: () => void;
  onAdicionarItem: () => void;
  onVerCancelamento: (itemId: number) => void;
  onTrocarItem: (item: PedidoItemRow) => void;
}

export default function PedidoItens({
  itens,
  valorTotalCentavos,
  anulado,
  arquivado,
  origemPedido,
  statusComanda,
  statusPedido,
  onAbrirHistorico,
  onAdicionarItem,
  onVerCancelamento,
  onTrocarItem,
}: PedidoItensProps) {
  const itensAtuais = itens.filter(
    (item) =>
      anulado ||
      item.status_item === "ATIVO" ||
      item.status_item === "TROCA_PENDENTE",
  );

  return (
    <>
      {/* Items */}
      <div className="pedmodal-items">
        <div className="pedmodal-items-header">
          <span className="pedmodal-section-label">Itens do pedido</span>
          <div className="pedmodal-items-header-actions">
            <button
              type="button"
              className="pedmodal-btn-historico"
              onClick={onAbrirHistorico}
            >
              Histórico
            </button>
            {!anulado &&
              !arquivado &&
              origemPedido === "MANUAL" &&
              statusComanda === "ABERTA" &&
              (statusPedido === "NOVO" || statusPedido === "PREPARANDO") && (
                <button
                  type="button"
                  className="pedmodal-btn-add-item"
                  onClick={onAdicionarItem}
                >
                  + Adicionar produto
                </button>
              )}
          </div>
        </div>
        {itensAtuais.map((item) => (
          <div className="pedmodal-item-row" key={item.id}>
            <div className="pedmodal-item-info">
              <span className="pedmodal-item-name">
                {item.produto_nome} {item.emoji ?? ""}
              </span>
              <span className="pedmodal-item-state">
                {ITEM_STATUS_LABEL[item.status_item] ?? item.status_item} ·{" "}
                {STOCK_STATUS_LABEL[item.estoque_estado] ?? item.estoque_estado}
              </span>
              {item.status_item === "TROCA_PENDENTE" && (
                <span className="pedmodal-item-note">
                  Fora do total até a troca ser concluída
                </span>
              )}
              <span className="pedmodal-item-qty">
                {item.quantidade}x {formatarPreco(item.valor_unitario_centavos)}
              </span>
            </div>
            <div className="pedmodal-item-actions">
              <span className="pedmodal-item-price">
                {formatarPreco(item.valor_total_centavos)}
              </span>
              {item.cancelamento_id && (
                <span className="pedmodal-item-qty">
                  {FLOW_STATUS_LABEL[item.cancelamento_status ?? ""] ??
                    "Cancelamento em andamento"}
                </span>
              )}
              {item.troca_id && (
                <span className="pedmodal-item-qty">
                  {FLOW_STATUS_LABEL[item.troca_status ?? ""] ??
                    "Troca em andamento"}
                </span>
              )}
              {!anulado &&
                item.status_item === "ATIVO" &&
                statusComanda === "ABERTA" &&
                statusPedido !== "ENTREGUE" &&
                statusPedido !== "CANCELADO" &&
                (!item.troca_id ||
                  (item.troca_status === "CONCLUIDA" &&
                    item.troca_item_origem_id !== item.id)) && (
                  <>
                    <button
                      type="button"
                      className={`pedmodal-btn-cancel-item${item.cancelamento_id ? " pedmodal-btn-cancel-item--neutral" : ""}`}
                      onClick={() => onVerCancelamento(item.id)}
                    >
                      {item.cancelamento_id
                        ? "Ver cancelamento"
                        : "Cancelar item"}
                    </button>
                    {!item.cancelamento_id && (
                      <button
                        type="button"
                        className="pedmodal-btn-cancel-item pedmodal-btn-cancel-item--neutral"
                        onClick={() => onTrocarItem(item)}
                      >
                        Trocar produto
                      </button>
                    )}
                  </>
                )}
              {!anulado &&
                item.cancelamento_id &&
                item.status_item !== "ATIVO" && (
                  <button
                    type="button"
                    className="pedmodal-btn-cancel-item pedmodal-btn-cancel-item--neutral"
                    onClick={() => onVerCancelamento(item.id)}
                  >
                    Ver cancelamento
                  </button>
                )}
              {!anulado &&
                item.troca_id &&
                item.troca_item_origem_id === item.id && (
                  <button
                    type="button"
                    className="pedmodal-btn-cancel-item pedmodal-btn-cancel-item--neutral"
                    onClick={() => onTrocarItem(item)}
                  >
                    Ver troca
                  </button>
                )}
            </div>
          </div>
        ))}
      </div>

      {/* Summary */}
      <div className="pedmodal-summary">
        <div className="pedmodal-summary-row">
          <span className="pedmodal-summary-label">Subtotal</span>
          <span className="pedmodal-summary-value">
            {formatarPreco(valorTotalCentavos)}
          </span>
        </div>
        <div className="pedmodal-summary-row pedmodal-summary-row--total">
          <span className="pedmodal-total-label">Total</span>
          <span className="pedmodal-total-value">
            {formatarPreco(valorTotalCentavos)}
          </span>
        </div>
      </div>
    </>
  );
}
