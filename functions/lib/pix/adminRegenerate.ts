/// <reference types="@cloudflare/workers-types" />
import type { PixOrderBody } from "../mp/orders/types";
import { registrarFase } from "../operacoes";
import type { GerarPixAdminResult } from "./types";

export interface RegenerateAdminPixArgs {
  env: {
    DB: D1Database;
    MP_ACCESS_TOKEN: string;
  };
  pedidoId: number;
  usuarioId: number;
  substituiId: number;
  operationKey: string;
  valorCentavos: number;
  idempotencyKey: string;
  mpIdempotencyKey: string;
  mpRequest: PixOrderBody;
  reservaStatements: D1PreparedStatement[];
  waterfall: {
    alocacoes: Array<{
      itemId: number;
      valorCentavos: number;
    }>;
  };
}

export async function regenerateAdminPix(
  args: RegenerateAdminPixArgs
): Promise<GerarPixAdminResult> {
  // The predecessor claim does not reserve financial authorization for the order.
  // Suspend dispatch entirely: another capture or balance reduction can arrive
  // during remote I/O. A read before POST or a CAS after POST cannot undo that charge.
  // This claim is known not to have dispatched. Historical inconclusive operations
  // still use replay/recovery, which never call this function or create another order.
  await registrarFase(args.env.DB, args.operationKey, {
    fase: "RECUSADA",
    erro: "PIX_REGENERACAO_SUSPENSA"
  });
  return { ok: false, erro: "PIX_REGENERACAO_SUSPENSA" };
}
