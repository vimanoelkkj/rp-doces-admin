import assert from "node:assert/strict";

// Legacy exchange snapshots predate migration 0037. Assert the new operational
// fields remain inactive, then preserve every original field for the frozen hash.
// Do not discard unknown fields or regenerate the financial contract fixtures.
export function exchangeContractState(snapshot) {
  return {
    ...snapshot,
    pagamentos: snapshot.pagamentos.map(payment => {
      const { push_pedido_pago, push_exclude_usuario_id, ...original } = payment;
      assert.equal(push_pedido_pago, 0, "exchange must not create a paid-order push intent");
      assert.equal(push_exclude_usuario_id, null, "exchange must not set a recipient exclusion");
      return original;
    })
  };
}
