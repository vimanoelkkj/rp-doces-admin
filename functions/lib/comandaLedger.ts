/**
 * Fachada pública e explícita do ledger de comandas e pagamentos.
 *
 * Preserva a API pública retrocompatível do Target 1 da modularização,
 * delegando para os módulos de domínio especializados sob `functions/lib/ledger/`.
 *
 * Módulos internos:
 * - `ledger/types.ts`: Tipos fundamentais compartilhados.
 * - `ledger/allocations.ts`: Algoritmos e consultas de alocação por item (waterfall).
 * - `ledger/legacy.ts`: Materialização lazy e compatibilidade com pedidos legados.
 * - `ledger/projection.ts`: Projeções de saldo, totalizadores e recálculo financeiro.
 * - `ledger/adminOps.ts`: Replay e reconciliação de fatos administrativos (interno).
 * - `ledger/adminPayments.ts`: Registro de pagamentos manuais via painel admin.
 * - `ledger/adminRefunds.ts`: Registro de estornos e reembolsos manuais.
 */

// 1. Tipos fundamentais (ledger/types.ts)
export type {
  LedgerStatus,
  LedgerMetodo,
  StatusFinanceiroAgregado,
} from "./ledger/types";

// 2. Domínio Legado (ledger/legacy.ts)
export type {
  LegacyStatusResult,
  MaterializeResult,
} from "./ledger/legacy";

export {
  ledgerPaymentStatus,
  ensureLegacyPaymentMaterialized,
  resolveLedgerPaymentId,
} from "./ledger/legacy";

// 3. Domínio de Alocações (ledger/allocations.ts)
export type {
  ItemComSaldo,
} from "./ledger/allocations";

export {
  allocateFullValueAcrossItems,
  getItensComSaldo,
  computeWaterfallAllocations,
} from "./ledger/allocations";

// 4. Domínio de Projeção / Consulta (ledger/projection.ts)
export type {
  FinanceiroPedido,
} from "./ledger/projection";

export {
  getPaidCentavos,
  getRefundedCentavos,
  getNetPaidCentavos,
  recalculatePedidoStatusPagamento,
  hasNetConfirmedPayment,
  getFinanceiroPedido,
  getFinanceirosPorPedidos,
  getComandaSaldo,
} from "./ledger/projection";

// 5. Pagamentos Administrativos (ledger/adminPayments.ts)
export type {
  MetodoManual,
  RegisterAdminPaymentResult,
} from "./ledger/adminPayments";

export {
  registerAdminPayment,
} from "./ledger/adminPayments";

// 6. Reembolsos Administrativos (ledger/adminRefunds.ts)
export type {
  RegisterRefundResult,
} from "./ledger/adminRefunds";

export {
  registerManualRefund,
} from "./ledger/adminRefunds";
