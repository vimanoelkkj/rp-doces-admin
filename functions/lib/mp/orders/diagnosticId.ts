import { createPixOrderBody, orderExternalReference, type PixOrderBody } from "./types";

const VALOR_DIAGNOSTICO_CENTAVOS = 1;

// Opaque round-trip identifier for the diagnostic UI, which has no persisted
// payment row. The UI forwards it unchanged; ledger IDs remain separate.
export function diagnosticPaymentId(orderId: string, paymentId: string): string {
  return `${orderId}:${paymentId}`;
}

export function parseDiagnosticPaymentId(
  value: unknown
): { orderId: string; paymentId: string } | null {
  if (typeof value !== "string") return null;
  const match = /^(ORD[A-Za-z0-9]+):(PAY[A-Za-z0-9]+)$/.exec(value.trim());
  return match ? { orderId: match[1], paymentId: match[2] } : null;
}

export async function diagnosticExternalReference(operationKey: string): Promise<string> {
  const prefix = "ADMIN_DIAG_PIX_";
  const reference = await orderExternalReference(`${prefix}${operationKey}`);
  return reference.startsWith(prefix)
    ? reference
    : `${prefix}${reference.slice(0, 64 - prefix.length)}`;
}

// Cria o body exclusivo para o Pix de diagnóstico permanente.
// Em modo simulador de teste (MP_TEST_MODE === "orders_pix"), utiliza o contrato
// rígido exigido pelo sandbox oficial da Orders API do Mercado Pago (R$ 50.00,
// pagador APRO/test_user_br@testuser.com e sem campos de expiração).
// Em modo normal/produção, utiliza o Pix de 1 centavo com expiração padrão.
export async function createDiagnosticPixOrderBody(
  reference: string,
  testMode?: string
): Promise<PixOrderBody> {
  if (testMode === "orders_pix") {
    return {
      type: "online",
      total_amount: "50.00",
      external_reference: await orderExternalReference(reference),
      processing_mode: "automatic",
      transactions: {
        payments: [
          {
            amount: "50.00",
            payment_method: { id: "pix", type: "bank_transfer" }
          }
        ]
      },
      payer: {
        email: "test_user_br@testuser.com",
        first_name: "APRO"
      }
    };
  }

  return createPixOrderBody(
    VALOR_DIAGNOSTICO_CENTAVOS,
    reference,
    { email: "diagnostico@rpdoces.com.br", first_name: "Diagnostico" },
    testMode
  );
}
