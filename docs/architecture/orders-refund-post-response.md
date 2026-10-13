# Orders refund response identity

## Documented evidence

Sources inspected on 2026-10-13, without provider operations:

- [Checkout API refund reference](https://www.mercadopago.com.br/developers/en/reference/online-payments/checkout-api/refund-order/post): `POST /v1/orders/{order_id}/refund`, required `X-Idempotency-Key`, HTTP 201, partial requests with a transaction ID and decimal amount. Its example contains one REF, original PAY, amount, status and `reference_id`. It also documents HTTP 409 for a reused key.
- [Official OpenAPI](https://github.com/mercadopago/openapi/blob/main/spec3.yaml): `refundOrder` declares HTTP 201 with Order ID, status, status detail and a transactions object. It does not constrain refund membership or define replay identity. `OrderRefundRequest` exposes transaction ID and amount, without an operation-to-REF correlation field.
- [Official Node SDK refund implementation](https://github.com/mercadopago/sdk-nodejs/blob/master/src/clients/order/refund/index.ts): returns the updated `OrderResponse`, including new refund records. This SDK description does not guarantee that only this POST's refunds are returned or that replay returns an immutable operation-specific result.
- [SDK request types](https://github.com/mercadopago/sdk-nodejs/blob/master/src/clients/order/refund/types.ts) expose transaction ID and amount separately from idempotency options. [SDK response types](https://github.com/mercadopago/sdk-nodejs/blob/master/src/clients/order/commonTypes.ts) call `reference_id` integrator-assigned; the [QR migration guide](https://www.mercadopago.com.br/developers/en/docs/qr-code/resources/migrate-dynamic-qr-model-to-orders) describes a payment/refund association. Neither establishes an echo of our local key in this online endpoint. QR is a different product context.

## What remains uncertain

The example's singleton is not an operation-identity guarantee. Singularity, matching ORD/PAY/amount, an empty baseline, a new REF, `processed`, refund acknowledgement or `reference_id` resembling our key do not prove origin. Stable idempotency preserves the outgoing request identity; it does not prove the returned REF's identity.

No verifiable correlation mechanism was found in those sources. This is a limit of the inspected public contracts, not proof that the provider has no internal mechanism. Enabling automatic attribution requires an explicit provider contract for operation-to-REF binding and replay. No speculative header, metadata field, lookup or fallback is introduced.

## What the code can safely confirm

The direct POST parser validates wire shape only and never exports a REF as authoritative. A readable matching HTTP 201 becomes `AMBIGUO/IDENTIDADE_NAO_COMPROVADA:201`, separately from malformed/unreadable responses (`RESPOSTA_ILEGIVEL`). Both retain `INCONCLUSIVO`, a null `mp_refund_id`, reserved capacity and unchanged financial/stock state. Pending or processed status cannot establish identity.

Direct POST and general GET parsers remain separate. GET recovery requires an already known REF and verifies that exact ID, expected ORD/PAY and amount before the existing status mapping and materialization. The known-ID fixture verifies recovery only; its explicit local seed does not establish identity from the preceding POST. Persisting an ID is not itself proof of its provenance.

Request persistence, stable provider key, dispatch lease/CAS, capacity, ledger, stock and historical Payments API paths remain intact. Explicit simulated replay uses the same body/key and stays inconclusive. This correction adds no retry, manual REF assignment or remote operation.

## What must remain inconclusive

An Orders intention without independently established REF identity remains inconclusive after HTTP 201, timeout, transport loss, HTTP 409 or a matching general GET. It cannot be accounted financially or resolved by selecting from history. Automatic first-POST confirmation is intentionally unavailable until correlation is evidenced.

RP-23 was not accessed or modified. No historical REF is inferred or backfilled. This correction does not retroactively establish the provenance of IDs saved using the rejected assumption.

## Regression evidence and limits

P2 exercises the real intention flow with disposable local D1 and a simulated provider: empty baseline, complete-looking HTTP 201 and a sole external REF of the same ORD/PAY/amount, even with `reference_id` equal to the outgoing key. On `55b5b349` it reproduced unsafe `CONFIRMADO`; the corrected path retains `INCONCLUSIVO` and no REF, including same-key replay. Assertions cover persisted order, payments, refunds, allocations, items and stock.

Other cases cover malformed/aggregate responses, timeout after simulated effect, deterministic concurrency, incompatible key reuse, multiple payments and known-ID recovery. Passing simulations demonstrates containment for those cases, not provider correlation or remote homologation. No real Mercado Pago call, remote D1 write, secret change, merge or deployment is part of this work.
