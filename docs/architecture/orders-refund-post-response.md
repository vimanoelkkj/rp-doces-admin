# Orders refund response identity

## Defect and official contract

On the staging base `dfbdde52`, `postRefundMp` passed an undefined refund ID to
the general Order recovery parser. That parser correctly requires a known REF,
so even the first valid HTTP 201 response became `RESPOSTA_ILEGIVEL:201`.

The [online Checkout API refund reference](https://www.mercadopago.com.br/developers/en/reference/online-payments/checkout-api/refund-order/post)
documents `POST /v1/orders/{order_id}/refund`, HTTP 201, a required
`X-Idempotency-Key`, and a partial request containing one transaction ID and a
decimal amount. Its response example contains the Order ID, `status=processed`,
`status_detail=refunded`, and one `transactions.refunds` entry with a REF ID,
`transaction_id` (PAY), decimal amount, status and provider reference.
The same reference lists `refunded` and `partially_refunded` acknowledgements.
Checked on 2026-10-13; no provider operation was executed.

## Direct POST versus general GET

The direct POST parser accepts only the documented HTTP 201 refund response:
the expected ORD, a refund acknowledgement, a refunds-only transaction object
and exactly one complete REF for the requested PAY and amount. The REF comes
from the successful response to this specific idempotent request. PAY and amount
validate that result; they do not select a candidate from Order history.
The stored baseline is only a veto against a previously known REF. It never
turns a list of historical refunds into an operation result.

General GET recovery still requires the exact REF already persisted locally.
An unknown REF cannot be adopted from a GET, even if its PAY and amount match,
it is the only visible refund, or it did not occur in the baseline. The provider
`reference_id` is not treated as an echo of our idempotency key.

Missing acknowledgement, malformed identities, multiple REF entries (including
other payments or duplicate IDs), a payments aggregate, a previously known REF,
or a success status other than the documented 201 remains ambiguous. Unknown
refund states retain the existing conservative status mapping. A pending REF
can be persisted for exact-ID recovery without materializing a financial fact.

Timeout, transport failure and HTTP 409 do not prove a refund identity. Explicit
retry retains the persisted request body and provider key; a valid direct 201
can resolve it, but a general Order observation cannot. No lease, capacity, CAS,
stock, ledger, SQL or historical Payments API behavior changes.

## RP-23 limitation and local evidence

The reported RP-23 response body was not provided or accessed. Reproducing its
classification with the official response shape proves the parser defect, not
the identity of its historical remote refund. RP-23 must remain inconclusive
unless independent evidence establishes the REF belonging to its local intent.
This correction does not infer or backfill that identity.

`tests/mp-orders-refund-post.test.mjs` exercises the production parser and real
estorno handler with a disposable local D1 and simulated provider. Coverage
includes direct 201, incomplete/ambiguous responses, baseline negative controls,
GET without identity, exact-ID recovery, timeout after remote effect, same-key
replay, incompatible key reuse, deterministic concurrency and independent
payment legs. Existing refund timeout and financial recovery suites remain part
of validation. Remote Mercado Pago, remote D1 and staging HTTP financial effects
are not tested or modified.
