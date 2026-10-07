export interface MpOrder {
  id: string;
  type?: string;
  external_reference?: string | null;
  total_amount?: string | null;
  status: string;
  status_detail?: string | null;
  country_code?: string | null;
  created_date?: string | null;
  last_updated_date?: string | null;
  transactions?: {
    payments?: Array<{
      id: string;
      amount?: string | null;
      paid_amount?: string | null;
      status: string;
      status_detail?: string | null;
      date_of_expiration?: string | null;
      expiration_time?: string | null;
      payment_method?: {
        id?: string;
        type?: string;
        qr_code?: string;
        qr_code_base64?: string;
        ticket_url?: string;
      };
    }>;
    refunds?: Array<{
      id: string;
      transaction_id: string;
      amount: string;
      status: string;
    }>;
  };
}

export interface PixOrderPayment {
  amount: string;
  payment_method: { id: "pix"; type: "bank_transfer" };
  expiration_time?: "PT30M";
}

export interface PixOrderBody {
  type: "online";
  total_amount: string;
  external_reference: string;
  processing_mode: "automatic";
  transactions: {
    payments: [PixOrderPayment];
  };
  payer: { email: string; first_name?: string };
}

export function isBrazilCountryCode(country: unknown): boolean {
  return country == null || country === "" || country === "BR" || country === "BRA";
}

export function ordersPixPayer(
  payer: PixOrderBody["payer"],
  testMode?: string
): PixOrderBody["payer"] {
  return testMode === "orders_pix"
    ? { ...payer, email: "test_user_br@testuser.com", first_name: "APRO" }
    : payer;
}

export function centsToDecimal(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new Error("VALOR_CENTAVOS_INVALIDO");
  const value = BigInt(cents);
  return `${value / 100n}.${String(value % 100n).padStart(2, "0")}`;
}

export function decimalToCents(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) return null;
  const cents = BigInt(match[1]) * 100n + BigInt((match[2] ?? "").padEnd(2, "0") || "0");
  return cents <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(cents) : null;
}

export async function orderExternalReference(reference: string): Promise<string> {
  if (/^[A-Za-z0-9_-]{1,64}$/.test(reference)) return reference;
  return hashIdentity(reference);
}

export async function orderIdempotencyKey(key: string): Promise<string> {
  return key.length <= 128 ? key : hashIdentity(key);
}

async function hashIdentity(reference: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(reference));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function createPixOrderBody(
  cents: number,
  reference: string,
  payer: PixOrderBody["payer"],
  testMode?: string
): Promise<PixOrderBody> {
  const amount = centsToDecimal(cents);
  return {
    type: "online",
    total_amount: amount,
    external_reference: await orderExternalReference(reference),
    processing_mode: "automatic",
    transactions: {
      payments: [
        {
          amount,
          payment_method: { id: "pix", type: "bank_transfer" },
          expiration_time: "PT30M"
        }
      ]
    },
    payer: ordersPixPayer(payer, testMode)
  };
}
