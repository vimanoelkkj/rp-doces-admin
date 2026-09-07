import test from "node:test";
import assert from "node:assert/strict";
import { checkoutLineItems } from "../public/assets/js/utils/checkout-payload.js";
import { checkoutReadiness } from "../public/assets/js/utils/checkout-readiness.js";
import { normalizeOrderResponse } from "../public/assets/js/utils/order-response.js";
import { catalogProducts } from "../public/assets/js/utils/catalog-response.js";
import { escapeHtml } from "../public/assets/js/utils/html.js";
import { formatMoney } from "../public/assets/js/utils/money.js";
import { stockCount, clampQuantity } from "../public/assets/js/utils/stock.js";

test("checkout line items remove invalid entries", () => {
  assert.deepEqual(
    checkoutLineItems([
      { product: { id: 1 }, quantity: 2.8 },
      { product: { id: "x" }, quantity: 1 },
      { product: { id: 2 }, quantity: 0 }
    ]),
    [{ produto_id: 1, quantidade: 2 }]
  );
});
test("checkout readiness rejects empty cart", () => {
  assert.equal(checkoutReadiness({}, []).reason, "empty");
});
test("order response normalizes paid state", () => {
  const result = normalizeOrderResponse({
    pedido: { token: "abc", status: "PAGO" },
    pix: { qr_code: "x" }
  });
  assert.equal(result.paid, true);
  assert.equal(result.token, "abc");
});
test("catalog response tolerates malformed payload", () => {
  assert.deepEqual(catalogProducts({ produtos: null }), []);
  assert.deepEqual(catalogProducts({ produtos: [null, { id: 1 }] }), [{ id: 1 }]);
});
test("html escaping protects rendered text", () => {
  assert.equal(escapeHtml(`<b a="x">&'</b>`), "&lt;b a=&quot;x&quot;&gt;&amp;&#039;&lt;/b&gt;");
});
test("money formatter consumes cents", () => {
  assert.match(formatMoney(1600), /16,00/);
});
test("stock count exposes only units not reserved", () => {
  assert.equal(stockCount({ estoque: 5, estoque_reservado: 3 }), 2);
  assert.equal(stockCount({ estoque: 1, estoque_reservado: 1 }), 0);
});
test("cart quantity never exceeds net available stock", () => {
  assert.equal(clampQuantity({ estoque: 5, estoque_reservado: 3, disponivel: true }, 5), 2);
});
