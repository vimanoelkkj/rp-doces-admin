import {
  type PedidoRecenteRow,
  formatarPreco,
  statusClass,
  statusLabel
} from "./adminDashboardHelpers";

export interface DashboardRecentOrdersProps {
  orders: PedidoRecenteRow[] | undefined;
  loading: boolean;
}

export default function DashboardRecentOrders({ orders, loading }: DashboardRecentOrdersProps) {
  return (
    <div className="dash-panel dash-recent-orders">
      <div className="dash-orders-header">
        <div className="dash-orders-title-group">
          <h2 className="dash-orders-title">Pedidos recentes</h2>
          <p className="dash-orders-subtitle">Últimos pedidos registrados no sistema nesse dia</p>
        </div>
        <a className="dash-btn-view-all" href="/admin/pedidos">
          Ver todos os pedidos
        </a>
      </div>

      <div className="dash-orders-table">
        <div className="dash-table-header">
          <span className="dash-th dash-th-id">ID</span>
          <span className="dash-th dash-th-client">Cliente</span>
          <span className="dash-th dash-th-items">Itens</span>
          <span className="dash-th dash-th-payment">Pagamento</span>
          <span className="dash-th dash-th-status">Status</span>
          <span className="dash-th dash-th-total">Total</span>
        </div>

        {!loading && orders && orders.length === 0 && (
          <p className="dash-empty-inline">Nenhum pedido registrado nesse dia.</p>
        )}

        {orders?.map(order => (
          <div className="dash-table-row" key={order.id}>
            <span className="dash-td dash-td-id">RP-{order.id}</span>
            <span className="dash-td dash-td-client">{order.cliente_nome}</span>
            <span className="dash-td dash-td-items">{order.itens_count} item(s)</span>
            <span className="dash-td dash-td-payment">
              <span className="dash-badge dash-badge--green">Pago</span>
            </span>
            <span className="dash-td dash-td-status">
              <span className={`dash-badge ${statusClass(order.status_pedido)}`}>
                {statusLabel(order.status_pedido)}
              </span>
            </span>
            <span className="dash-td dash-td-total">
              {formatarPreco(order.valor_total_centavos)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
