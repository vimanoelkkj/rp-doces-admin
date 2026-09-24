import type { D1Database } from "@cloudflare/workers-types";
import type { StatusFinanceiroAgregado } from "./types";
import { getComandaSaldo } from "./projection";
import { reconcilePedidoAfterFinancialChange } from "../pedidoReconcile";
import {
  conflitoOperacao,
  type ConflitoOperacao,
  type IdentidadeEsperada,
  type OperacaoRow,
} from "../operacoes";

// Somente após a confirmação da escrita financeira. Uma falha derivada não
// pode induzir o operador a registrar o mesmo fato novamente (A1 é separado).
export async function reconcilePersistedAdminFact(
  db: D1Database,
  pedidoId: number,
  operacao: "PAGAMENTO" | "REEMBOLSO",
  fatoId: number,
): Promise<{ statusFinanceiro?: StatusFinanceiroAgregado; saldoCentavos?: number }> {
  try {
    const reconciliacao = await reconcilePedidoAfterFinancialChange(db, pedidoId);
    if (!reconciliacao.ok) throw new Error(reconciliacao.motivo);
    const saldo = await getComandaSaldo(db, pedidoId);
    return { statusFinanceiro: reconciliacao.statusFinanceiro, saldoCentavos: saldo.saldo };
  } catch (err) {
    console.error("Fato financeiro administrativo persistido; falha nos efeitos derivados", {
      pedidoId, operacao, fatoId,
    }, err);
    // Não inventa saldo/status nem tenta uma nova leitura que pode falhar.
    // A divergência persistida continua elegível para recuperação pelo B3.
    return {};
  }
}

// A1 — replay de uma operação LOCAL já persistida (pagamento manual /
// refund manual / criação ADMIN). Nunca cria um fato novo: valida a
// compatibilidade da key e devolve o MESMO id, reconciliando pelo B3
// (convergente e idempotente) para que o estado derivado continue correto
// mesmo que a resposta original tenha se perdido.
//
// Para operações locais o replay é reconstruído a partir das LINHAS
// persistidas, não de um snapshot JSON: as linhas são a fonte da verdade e
// nunca podem divergir de si mesmas.
export async function replayOperacaoLocal(
  db: D1Database,
  operacao: OperacaoRow,
  esperado: IdentidadeEsperada,
  fato: "PAGAMENTO" | "REEMBOLSO",
): Promise<
  | {
      ok: true;
      id: number;
      statusFinanceiro?: StatusFinanceiroAgregado;
      saldoCentavos?: number;
    }
  | { ok: false; erro: ConflitoOperacao | "OPERACAO_INCOMPLETA" }
> {
  const conflito = conflitoOperacao(operacao, esperado);
  if (conflito) return { ok: false, erro: conflito };

  const id = Number(
    (fato === "PAGAMENTO" ? operacao.pagamento_id : operacao.reembolso_id) || 0,
  );
  const pedidoId = Number(operacao.pedido_id || 0);
  // Operação local só é registrada junto com o fato, no mesmo batch — um
  // claim sem fato não deveria existir. Se existir, é estado corrompido:
  // reporta em vez de recriar o fato financeiro por conta própria.
  if (!id || !pedidoId) return { ok: false, erro: "OPERACAO_INCOMPLETA" };

  const derivados = await reconcilePersistedAdminFact(db, pedidoId, fato, id);
  return { ok: true, id, ...derivados };
}
