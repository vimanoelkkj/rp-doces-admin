// Independent wire fixtures for the migrated provider. Existing money scenarios
// retain their named inputs and financial assertions; no production mapper is
// used to build their simulated Orders responses.
const initialRefundOrders = new WeakMap();
const successfulRefundOrders = new WeakMap();

// Existing refund scenarios start before dispatch. Model the new pre-dispatch
// observation explicitly, then delegate POSTs and known-REF recovery to their
// scenario-specific provider. State survives replacing the mock in one test.
export function mockRefundProvider(t, provider) {
  const observed = initialRefundOrders.get(t) ?? new Set();
  initialRefundOrders.set(t, observed);
  const successful = successfulRefundOrders.get(t) ?? new Set();
  successfulRefundOrders.set(t, successful);
  return t.mock.method(globalThis, "fetch", async (url, init) => {
    const order = /\/v1\/orders\/(ORD[A-Za-z0-9]+)$/.exec(String(url));
    if (init?.method !== "POST" && order && !observed.has(order[1])) {
      observed.add(order[1]);
      return Response.json({ id: order[1], status: "processed", transactions: { refunds: [] } });
    }
    const response = await provider(url, init);
    const target = /\/v1\/orders\/(ORD[A-Za-z0-9]+)\/refund$/.exec(String(url));
    if (init?.method === "POST" && response.ok && target) successful.add(target[1]);
    if (
      init?.method === "POST" &&
      response.status >= 400 &&
      response.status < 500 &&
      ![402, 408, 409, 423, 429].includes(response.status)
    ) {
      if (target && !successful.has(target[1])) observed.delete(target[1]);
    }
    return response;
  });
}

export function orderFixture(payment = {}) {
  const id = String(payment.id ?? 101).replace(/^PAY|^ORD/, "");
  const status = {
    approved: ["processed", "accredited"],
    pending: ["action_required", "waiting_transfer"],
    in_process: ["action_required", "waiting_transfer"],
    authorized: ["action_required", "waiting_transfer"],
    cancelled: ["canceled", null],
    rejected: ["canceled", null],
    expired: ["expired", null],
    refunded: ["refunded", "refunded"]
  }[payment.status] ?? [payment.status, payment.status_detail];
  const amount = Object.hasOwn(payment, "transaction_amount")
    ? payment.transaction_amount
    : payment.status === "approved"
      ? 100
      : undefined;
  const money = value =>
    typeof value === "number" && Number.isFinite(value) ? value.toFixed(2) : value;
  return {
    id: `ORD${id}`,
    type: "online",
    status: status[0],
    status_detail: status[1],
    external_reference: Object.hasOwn(payment, "external_reference")
      ? payment.external_reference
      : payment.status === "approved"
        ? "token"
        : null,
    total_amount: money(amount),
    country_code: payment.currency_id === "USD" ? "US" : "BR",
    last_updated_date: payment.date_approved,
    transactions: {
      payments: [
        {
          id: `PAY${id}`,
          status: status[0],
          status_detail: status[1],
          amount: money(amount),
          date_of_expiration: payment.date_of_expiration,
          payment_method: {
            id: Object.hasOwn(payment, "payment_method_id")
              ? payment.payment_method_id
              : payment.status === "approved"
                ? "pix"
                : undefined,
            type: "bank_transfer",
            ...payment.point_of_interaction?.transaction_data
          }
        }
      ]
    }
  };
}

export function mpResponse(value, init) {
  if (value?.transactions) return Response.json(value, init);
  if (value && Array.isArray(value.results)) {
    return Response.json({ data: value.results.map(orderFixture), paging: value.paging }, init);
  }
  if (value && Object.hasOwn(value, "payment_id") && value.status) {
    return Response.json(
      {
        id: `ORD${String(value.payment_id).replace(/^PAY/, "")}`,
        status: "processed",
        transactions: {
          refunds: [
            {
              id: `REF${String(value.id).replace(/^REF/, "")}`,
              transaction_id: `PAY${String(value.payment_id).replace(/^PAY/, "")}`,
              amount:
                typeof value.amount === "number"
                  ? value.amount.toFixed(2)
                  : (value.amount ?? "0.01"),
              status: value.status === "approved" ? "processed" : value.status
            }
          ]
        }
      },
      init
    );
  }
  return Response.json(value?.id != null && value.status ? orderFixture(value) : value, init);
}
