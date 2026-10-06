# Durable Web Push outbox

Payment confirmation and paid manual order creation await registration in
`push_eventos`, then publish only `{ pedidoId, evento: "PEDIDO_PAGO" }` to
`PUSH_QUEUE`. They never await Web Push transport. Queue publication failures
are sanitized and logged; the persisted intent remains recoverable even when the
initial outbox insert fails. The original
manual order author exclusion is persisted as `exclude_usuario_id`; replays do
not overwrite it. Existing events use `NULL`.

For compatibility, a direct send can adopt an exclusion for a legacy `PENDENTE`
event whose exclusion is `NULL`, attempts are zero and claim token is absent.
It cannot replace an existing exclusion or an already acquired/attempted policy.

Migration `0037` adds `push_pedido_pago` and `push_exclude_usuario_id` as operational
metadata on `pedido_pagamentos`. The notifying Pix transition records the intent
in its existing guarded `UPDATE`; a paid manual creation records it and a copy of
the author ID in its existing payment `INSERT`/batch. Payment status and intent
commit together, including when execution stops before reconciliation or outbox
registration. No `push_eventos` insert, Queue or transport operation is added to
the financial transaction, and its amounts, guards and statement order are unchanged.

Scheduled recovery first reconstructs at most five missing events in payment-ID
order from explicit intents whose payment is `PAGO`. It never scans aggregate
`pedidos.status_pagamento = 'PAGO'` as evidence of intent. Existing/historical
payments, later ordinary manual payments and internal Pix synchronization without
the notification environment retain the default zero intent. Invalid MP approvals
cannot set the marker. The exclusion copy has no FK, so it survives clearing
`registrado_por_usuario_id` on administrator deletion. Reconstruction uses
`NOT EXISTS` and `ON CONFLICT DO NOTHING`: it cannot reset `ENVIADO`, an active
claim, failed attempts or an existing recipient policy. The intent is retained
for recovery; `push_eventos` remains the only delivery state machine.

D1 is the sole delivery authority. `workers/push.ts` consumes identifiers and
calls `processarPushEventoPersistido`, reusing the existing CAS, renewable
120-second lease, token fencing, recipient selection and sequential transport.
Duplicate messages and concurrent consumers cannot acquire an active claim or
resend an `ENVIADO` event. Delivery remains at-least-once: remote acceptance
followed by a crash before local completion can cause a duplicate on recovery.

The consumer acknowledges persisted business failures. An infrastructure
exception causes Queue retry only when a coherent `FALHA`/`ENVIADO` cannot be
observed. Queue redelivery has three retries; it does not increase D1 attempts
or bypass D1 eligibility. The once-per-minute scheduled handler scans at most
five eligible events in the existing order. It recovers expired `PENDENTE`
leases, including unpublished messages, and `FALHA` after the existing
30-second backoff, with the existing three-attempt ceiling. An exception after
claim can leave a lease until expiry. Never recover a lease that is still active.

## Deployment

Pages supports Queue producers; the consumer/scheduled handler is a separate
Worker, not a Pages route. See [Pages bindings](https://developers.cloudflare.com/pages/functions/bindings/#queue-producers)
and [Queues APIs](https://developers.cloudflare.com/queues/configuration/javascript-apis/).
The existing CI publishes Pages only; Worker updates must be deployed separately.
No remote mutation or deployment is performed by tests.

### First bootstrap (Wrangler 3.114.17)

Hold the main/Pages deployment until all steps below finish. This sequence is for
the first provisioning of `rp-doces-push`, not for replacing an already active
consumer. The bootstrap entry point has only an inert HTTP response and its
configuration has no D1, Queue consumer, routes or cron. Secret commands may
publish a new version, but that version is still the inert bootstrap Worker.

Use the appropriate Cloudflare account, in this exact order:

```sh
npx wrangler d1 migrations apply rp-doces-db --remote
npx wrangler queues create rp-doces-push
npx wrangler deploy --config wrangler.push.bootstrap.toml
npx wrangler secret bulk C:\private\rp-doces-vapid.json --config wrangler.push.bootstrap.toml
npx wrangler secret list --config wrangler.push.bootstrap.toml
# STOP unless all three expected secrets are present and their source values validated.
npx wrangler deploy --config wrangler.push.toml --keep-vars
npx wrangler secret list --config wrangler.push.toml
```

The private JSON path is an example outside the repository. Prepare the file
securely with exactly `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT`,
all containing the valid existing values. Never print or commit its contents.
Check the bulk upload reports three successes and `secret list` shows all three
names; names alone do not prove valid VAPID values. Stop on any error. Do not run
sequential `secret put` commands against the active consumer configuration.

The migration command must apply both `0036` and `0037` before activating the
Worker. Queue creation precedes every Queue binding. After active deployment,
verify in Cloudflare that `rp-doces-push` has the D1 binding, Queue consumer and
once-per-minute cron, all three secrets, and no failing configuration logs.
Only then release the normal Pages CI deployment with the `PUSH_QUEUE` producer
binding. Until that gate, keep the previous Pages version serving production.
Preview/local environments must use isolated D1/Queue resources.

Validated locally with installed Wrangler help/source and both deployment
dry-runs. Wrangler 3.114.17 supports `secret bulk`, `secret list` and `--keep-vars`
but not the newer `deploy --secrets-file` documented by Cloudflare. Its bulk
command updates all supplied secrets in one settings request; `--keep-vars`
also preserves secret bindings on the final upload. Cloudflare documents that
[secret commands deploy immediately](https://developers.cloudflare.com/workers/wrangler/commands/workers/#secret)
and [bulk secret provisioning](https://developers.cloudflare.com/workers/configuration/secrets/).
No CLI upgrade or remote deployment is part of this change.

Check Worker logs, queue backlog and `push_eventos` after deployment, including
manual author exclusion and scheduled recovery. A backlog larger than five
eligible events per minute may need capacity tuning separately. Missing VAPID
configuration consumes the existing failed-attempt budget, so check secrets
before enabling cron. A D1 outbox-registration outage does not erase the intent
committed with payment; later cron runs reconstruct it after D1 becomes available.
If the financial write itself fails, it commits neither payment nor intent.
This change does not make Web Push delivery a prerequisite for payment success.

For rollback, retain the additive migration. Revert the application to a known
SHA and disable the new Worker consumer/cron before reactivating synchronous
delivery. Do not drop outbox data; unfinished events remain governed by D1.
