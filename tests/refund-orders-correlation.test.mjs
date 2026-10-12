import test from "node:test";
import assert from "node:assert/strict";
import { app } from "./helpers/b3.mjs";

const order = {
  id: "ORD9",
  status: "processed",
  transactions: {
    refunds: [{ id: "REFexternal", transaction_id: "PAY9", amount: "2.00", status: "processed" }]
  }
};

test("Orders GET without known REF cannot correlate by a new PAY/amount candidate", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json(order));
  const result = await app.mpRefund.getRefundMp("fake", "ORD9", "PAY9", undefined, 200, []);
  assert.equal(result.resultado, "AMBIGUO");
});

for (const status of [200, 201, 202])
  test(`Orders aggregate ${status} cannot correlate a new REF to the submitted intent`, async t => {
    t.mock.method(globalThis, "fetch", async () => Response.json(order, { status }));
    const result = await app.mpRefund.postRefundMp("fake", "ORD9", "PAY9", "stable-key", {
      amountCentavos: 200,
      priorRefundIds: []
    });
    assert.equal(result.resultado, "AMBIGUO");
  });

test("Orders known REF remains recoverable and cannot select a different equal refund", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json(order));
  assert.equal(
    (await app.mpRefund.getRefundMp("fake", "ORD9", "PAY9", "REFexternal", 200)).resultado,
    "SUCESSO"
  );
  assert.equal(
    (await app.mpRefund.getRefundMp("fake", "ORD9", "PAY9", "REFother", 200)).resultado,
    "AMBIGUO"
  );
});
