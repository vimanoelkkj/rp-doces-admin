import { formatarFinanceiroTexto } from "./formatarFinanceiro";
import {
  type PedidoListItem,
  formatarPreco,
  statusClass,
  statusLabel
} from "./adminPedidosHelpers";

interface PedidosTabelaProps {
  pedidos: PedidoListItem[];
  loading: boolean;
  error: string | null;
  onSelectOrder: (id: number) => void;
}

export default function PedidosTabela({
  pedidos,
  loading,
  error,
  onSelectOrder
}: PedidosTabelaProps) {
  return (
    <>
      {/* Table header */}
      <div className="ped-table-header">
        <span className="ped-th ped-th-id">Pedido</span>
        <span className="ped-th ped-th-client">Cliente</span>
        <span className="ped-th ped-th-status">Status</span>
        <span className="ped-th ped-th-payment">Pagamento</span>
        <span className="ped-th ped-th-total">Total</span>
      </div>

      {error && <div className="ped-empty-message">{error}</div>}
      {!error && !loading && pedidos.length === 0 && (
        <div className="ped-empty-message">Nenhum pedido encontrado.</div>
      )}

      {/* Table rows */}
      {pedidos.map((pedido, i) => (
        <button
          type="button"
          key={pedido.id}
          className={`ped-table-row${i === pedidos.length - 1 ? " ped-table-row--last" : ""}`}
          onClick={() => onSelectOrder(pedido.id)}
        >
          <span className="ped-td ped-td-id">RP-{pedido.id}</span>
          <span className="ped-td ped-td-client">{pedido.cliente_nome}</span>
          <span className="ped-td ped-td-status">
            <span className={`ped-badge ${statusClass(pedido.status_pedido)}`}>
              {statusLabel(pedido.status_pedido)}
            </span>
          </span>
          <span className="ped-td ped-td-payment">
            <span
              className={`ped-badge ped-badge--${formatarFinanceiroTexto(pedido.financeiro).cor}`}
            >
              {formatarFinanceiroTexto(pedido.financeiro).texto}
            </span>
          </span>
          <span className="ped-td ped-td-total">{formatarPreco(pedido.valor_total_centavos)}</span>
        </button>
      ))}
    </>
  );
}
