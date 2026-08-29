import test from "node:test";
import assert from "node:assert/strict";
import { checkoutLineItems } from "../public/assets/js/utils/checkout-payload.js";
import { checkoutReadiness } from "../public/assets/js/utils/checkout-readiness.js";
import { normalizeOrderResponse } from "../public/assets/js/utils/order-response.js";
import { catalogProducts } from "../public/assets/js/utils/catalog-response.js";
import { escapeHtml } from "../public/assets/js/utils/html.js";

test("checkout line items remove invalid entries",()=>{assert.deepEqual(checkoutLineItems([{product:{id:1},quantity:2.8},{product:{id:"x"},quantity:1},{product:{id:2},quantity:0}]),[{produto_id:1,quantidade:2}]);});
test("checkout readiness rejects empty cart",()=>{assert.equal(checkoutReadiness({},[]).reason,"empty");});
test("order response normalizes paid state",()=>{const result=normalizeOrderResponse({pedido:{token:"abc",status:"PAGO"},pix:{qr_code:"x"}});assert.equal(result.paid,true);assert.equal(result.token,"abc");});
test("catalog response tolerates malformed payload",()=>{assert.deepEqual(catalogProducts({produtos:null}),[]);assert.deepEqual(catalogProducts({produtos:[null,{id:1}]}),[{id:1}]);});
test("html escaping protects rendered text",()=>{assert.equal(escapeHtml(`<b a="x">&'</b>`),"&lt;b a=&quot;x&quot;&gt;&amp;&#039;&lt;/b&gt;");});
