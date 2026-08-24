import { json } from "../../../lib/http.js";
import { requireUser } from "../../../lib/auth.js";

/**
 * GET /api/admin/health/payments
 *
 * Endpoint administrativo read-only para diagnóstico de saúde financeira e de estoque.
 * Consulta o D1 de forma puramente agregada (sem mutações, sem chamadas externas, sem PII).
 */
export async function onRequestGet({ request, env }) {
  const auth = await requireUser(env, request);
  if (auth.error) return auth.error;

  try {
    const row = await env.DB.prepare(`
      SELECT
        COALESCE(SUM(CASE
          WHEN status_pagamento = 'PAGO'
            AND estoque_baixado_em IS NULL
            AND COALESCE(pago_em, atualizado_em) <= datetime('now', '-2 minutes')
          THEN 1 ELSE 0 END), 0) AS pagos_sem_baixa_estoque,
        COALESCE(SUM(CASE
          WHEN reserva_status = 'ATIVA'
            AND reserva_expira_em IS NOT NULL
            AND reserva_expira_em <= datetime('now', '-5 minutes')
          THEN 1 ELSE 0 END), 0) AS reservas_vencidas_ativas,
        COALESCE(SUM(CASE
          WHEN status_pagamento = 'ERRO'
            AND reserva_status = 'ATIVA'
          THEN 1 ELSE 0 END), 0) AS erros_com_reserva_ativa,
        COALESCE(SUM(CASE
          WHEN status_pagamento = 'ERRO'
            AND reserva_status = 'ATIVA'
            AND reserva_expira_em IS NOT NULL
            AND reserva_expira_em <= datetime('now', '-5 minutes')
          THEN 1 ELSE 0 END), 0) AS erros_com_reserva_vencida
      FROM pedidos
    `).first();

    const metricas = {
      pagos_sem_baixa_estoque: Number(row?.pagos_sem_baixa_estoque || 0),
      reservas_vencidas_ativas: Number(row?.reservas_vencidas_ativas || 0),
      erros_com_reserva_ativa: Number(row?.erros_com_reserva_ativa || 0),
      erros_com_reserva_vencida: Number(row?.erros_com_reserva_vencida || 0)
    };

    let alertasAtivos = 0;
    if (metricas.pagos_sem_baixa_estoque > 0) alertasAtivos++;
    if (metricas.reservas_vencidas_ativas > 0) alertasAtivos++;
    if (metricas.erros_com_reserva_ativa > 0) alertasAtivos++;
    if (metricas.erros_com_reserva_vencida > 0) alertasAtivos++;

    let status = "healthy";
    if (metricas.pagos_sem_baixa_estoque > 0 || metricas.erros_com_reserva_vencida > 0) {
      status = "critical";
    } else if (metricas.reservas_vencidas_ativas > 0 || metricas.erros_com_reserva_ativa > 0) {
      status = "warning";
    }

    return json({
      status,
      alertas_ativos: alertasAtivos,
      metricas,
      timestamp: new Date().toISOString()
    }, 200);
  } catch (err) {
    return json({ erro: "Erro ao consultar saúde dos pagamentos." }, 500);
  }
}
