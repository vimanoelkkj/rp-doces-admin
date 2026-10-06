# Dedicated staging environment

> **NEVER run reset, DROP or DELETE against production resources.**
> Production is `rp-doces`, `rp-doces-db`, `rp-doces-images` and `rp-doces-push`.
> This runbook authorizes nothing automatically: provisioning, secrets, migrations,
> first deployment and any reset are separate manual operations.

## Architecture and isolation

| Resource              | Staging                   | Configuration                          |
| --------------------- | ------------------------- | -------------------------------------- |
| Pages                 | `rp-doces-staging`        | `wrangler.staging.toml`                |
| D1 / `DB`             | `rp-doces-db-staging`     | Pages and active Worker configs        |
| R2 / `PRODUCT_IMAGES` | `rp-doces-images-staging` | Pages config                           |
| Queue / `PUSH_QUEUE`  | `rp-doces-push-staging`   | Pages producer, Worker consumer        |
| Worker                | `rp-doces-push-staging`   | `wrangler.push.staging.toml`           |
| Inert first bootstrap | `rp-doces-push-staging`   | `wrangler.push.staging.bootstrap.toml` |

The Worker reuses `workers/push.ts`; the inert bootstrap reuses
`workers/push-bootstrap.ts`. Delivery policy, CAS, leases, financial operations,
stock and migrations are identical to production. No schema fork is introduced.
The consumer retains batch size 1, timeout 1 second, three Queue retries and the
once-per-minute cron. CI deploys Pages only; Worker updates remain manual.

Start with `https://rp-doces-staging.pages.dev`. Confirm the project URL after
creation; `STAGING_URL` can later select `https://staging.rpdoces.com.br` after its
DNS, certificate and Pages custom-domain setup are complete. The validator rejects
production URLs and credentials, paths or query strings in this variable.

The separate Pages project's **production branch is `staging`**. Cloudflare calls
its stable slot `production`, even though the application environment is staging.
The deployment verifier therefore uses `env=production` inside the
`rp-doces-staging` project. It never queries the production project.
Use Direct Upload, without a Git integration that bypasses the GitHub CI gate.

## Prerequisites and GitHub configuration

Use the locked Wrangler **3.114.17**, Node 24, the intended Cloudflare account and
a clean checkout containing these staging configs. Do not upgrade Wrangler for
this procedure. Commands below have **not** been executed remotely by this change.

Create GitHub Environment `staging`, restricting deployment branches to `staging`.
Populate all three environment secrets independently:

| Environment secret                 | Purpose                                               |
| ---------------------------------- | ----------------------------------------------------- |
| `STAGING_CLOUDFLARE_ACCOUNT_ID`    | Account containing the staging resources              |
| `STAGING_CLOUDFLARE_API_TOKEN`     | Staging Pages publication and deployment verification |
| `STAGING_CLOUDFLARE_D1_READ_TOKEN` | Separate token with Account / D1 / Read only          |

Environment variables:

| Variable                 | Value                                                                        |
| ------------------------ | ---------------------------------------------------------------------------- |
| `STAGING_DEPLOY_ENABLED` | Initially `false`; explicitly `true` only after provisioning                 |
| `STAGING_URL`            | Initially `https://rp-doces-staging.pages.dev`; optional default is the same |

GitHub exposes environment-level variables after the job starts. The enable switch
is deliberately evaluated inside the gated job, not in its job-level `if`.
Missing or non-`true` switch values skip publication and write a summary.
`DEPLOY_ENABLED` remains exclusive to the existing production job.

Staging references only the three `STAGING_CLOUDFLARE_*` GitHub secrets. Production
keeps its original generic names. With staging enabled, any missing staging secret
fails the first gate before HEAD lookup, installation, migration checks or publication;
there is no fallback to a generic production secret. Define the prefixed secrets
in Environment `staging`, using independently issued, least-privilege tokens.
Never put production values under a `STAGING_*` name at any GitHub scope.

The workflow maps the prefixed GitHub secrets to the generic process environment
variables required by Wrangler and the unchanged migration checker. Those runtime
variable names do not reference GitHub production secrets. The staging build step
explicitly sets the non-secret `VITE_APP_ENV=staging`; production does not set it.

Recommended future branch protection: require the aggregated `CI` check for both
`staging` and `main`; promote changes validated in staging to main when applicable.
No remote protection changes are made by this task.

## Initial provisioning: exact order

Keep `STAGING_DEPLOY_ENABLED=false` throughout provisioning. Every command below
is a **future manual operation**. Verify account identity before mutation.

### 1. Create D1 and insert its actual ID

```sh
npx wrangler d1 create rp-doces-db-staging --config wrangler.staging.toml
```

Copy the returned staging `database_id` into the `[[d1_databases]]` block in **both**
`wrangler.staging.toml` and `wrangler.push.staging.toml`, replacing
`STAGING_D1_ID_REPLACE_AFTER_CREATE`. Never copy the production ID. The bootstrap
has no D1 binding and needs no ID. The placeholder is deliberately not a UUID;
`--require-provisioned` refuses it before CI can query D1 or publish.

```sh
node scripts/check-staging-config.mjs --require-provisioned
npx wrangler d1 migrations apply DB --remote --config wrangler.staging.toml
npx wrangler d1 migrations list DB --remote --config wrangler.staging.toml
```

Apply **all** repository migrations, not only the latest. They are the same files
used by production. CI only checks the remote history/schema; it never applies SQL.

Optional initial data must be synthetic, reviewed SQL with fictitious customers,
test credentials and independent test image files. Never restore a production dump,
import PII or copy production images automatically. Only after validating isolation:

```sh
npx wrangler d1 execute DB --remote --config wrangler.staging.toml --file /secure/staging-synthetic-seed.sql
```

Prepare that file separately; it is not supplied by this task. Provision a dedicated
test administrator using the project's existing authentication setup and secure
password hashes. Do not copy an administrator/session from production.

### 2. Create the bucket, queue and Pages project

```sh
npx wrangler r2 bucket create rp-doces-images-staging --config wrangler.staging.toml
npx wrangler queues create rp-doces-push-staging --message-retention-period-secs 86400 --config wrangler.staging.toml
npx wrangler queues info rp-doces-push-staging --config wrangler.staging.toml
npx wrangler pages project create rp-doces-staging --production-branch staging
```

Queue creation must explicitly request **86400 seconds** of retention. Omitting
that option failed with the current production plan/CLI. Before rollout, zero
producers/consumers is expected; after rollout verify producer count >= 1 and
consumer count = 1, with only the staging Pages/Worker attached.

The Pages TOML supplies `PRODUCT_IMAGES` and `PUSH_QUEUE` on publication. Keep the
bucket private; the existing application image routes serve it. Do not reuse
`rp-doces-images`. Upload synthetic images through the staging admin only.

### 3. Prepare independent VAPID and sandbox credentials

Generate a new VAPID pair separately and securely, outside this task. It must be
different from production. Prepare a private JSON file outside the repository with
exactly `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`. Use a suitable
staging contact URI for the subject. Never print or commit secret values.

Prepare a separate private Pages JSON containing:

- `MP_ACCESS_TOKEN`: credentials explicitly issued for test/sandbox integration.
- `MP_WEBHOOK_SECRET`: signing secret for this independent test application/webhook.
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`: the **same staging pair**
  provisioned on the staging Worker.

The diagnostic endpoints inspected use `MP_ACCESS_TOKEN` and ordinary admin auth;
there is currently no additional diagnostics secret to provision. Never invent or
copy production credentials. Do not put secrets in `VITE_*`.

Configure the test webhook at `<STAGING_URL>/api/webhooks/mercadopago`, starting with
the Pages domain. Do not point test credentials/webhooks at `rpdoces.com.br`.
The application uses the Payments API, not the Orders API. Confirm current test
support for its Pix/refund/webhook flows in the relevant Mercado Pago documentation
before relying on manual payment simulation. Staging provisioning does not guarantee
that all external sandbox payment transitions can be simulated. If a sandbox flow
is unsupported, keep it disabled and use deterministic local mocks/tests; never
substitute a production token or real payment to bypass a sandbox limitation.

### 4. Bootstrap the inert Worker, then activate it

Wrangler 3.114.17 secret commands may publish a version immediately. During **first
provisioning only**, use the inert bootstrap with no D1, Queue consumer or cron:

```sh
npx wrangler deploy --config wrangler.push.staging.bootstrap.toml
npx wrangler secret bulk /secure/staging-vapid.json --config wrangler.push.staging.bootstrap.toml
npx wrangler secret list --config wrangler.push.staging.bootstrap.toml
```

Stop unless the bulk command reports three successes and the names/independent
source values have been validated. Names alone do not prove a valid key pair.
Never use this bootstrap config on an already active Worker: it detaches its
consumer/cron. Do not run sequential secret commands against the active consumer.

```sh
npx wrangler deploy --config wrangler.push.staging.toml --keep-vars
npx wrangler secret list --config wrangler.push.staging.toml
npx wrangler queues info rp-doces-push-staging --config wrangler.staging.toml
npx wrangler pages secret bulk /secure/staging-pages.json --project-name rp-doces-staging
npx wrangler pages secret list --project-name rp-doces-staging
```

Verify the Worker name, staging D1, queue, cron and all three VAPID secrets. The
bootstrap must finish before the active consumer is deployed. For later Worker
code releases, validate isolation and use the active config with `--keep-vars`;
do not bootstrap again. Pages and Worker releases are separate operations.

### 5. Validate schema with a read-only token

In a shell configured with **staging-only** account and read token:

```powershell
$env:WRANGLER_TOML = 'wrangler.staging.toml'
$env:D1_DATABASE_ID = '<actual-staging-database-id>'
$env:CLOUDFLARE_API_TOKEN = ''
node scripts/check-d1-migrations.mjs
```

For this manual CLI operation, supply the generic process variables
`CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_D1_READ_TOKEN` using the staging credentials
corresponding to GitHub `STAGING_CLOUDFLARE_ACCOUNT_ID` and
`STAGING_CLOUDFLARE_D1_READ_TOKEN`. Use your approved secret mechanism; do not paste
values into shell history. Require a clean history
and successful latest-schema verification. Existing migration-check CLI text may
say "production"; the explicit config/ID determines the actual staging target.

### 6. Enable the first Pages deployment

Commit the two actual staging D1 IDs through a reviewed PR, merge to `staging`,
then set Environment `staging` variable `STAGING_DEPLOY_ENABLED=true` and trigger
a new push to that branch. Re-running a run after enabling the variable is also
possible if its SHA remains the branch HEAD. Full CI must pass first.

The staging job checks credentials and HEAD, installs the locked dependencies,
validates resource isolation, checks migrations read-only, builds with
`VITE_APP_ENV=staging`, checks HEAD again, uploads to `rp-doces-staging`, verifies
the full SHA/success through the Cloudflare API, then runs the read-only smoke suite.
Superseded/disabled runs do not publish. If HEAD advances during build, verification
and smoke are skipped unless this run actually uploaded.

**Wrangler Pages 3.114.17 rejects `--config`.** Immediately before upload, the job
copies `wrangler.staging.toml` to `wrangler.toml` in its disposable checkout. This
does not modify the committed production config. The supported upload command is:

```sh
npx wrangler pages deploy dist --project-name rp-doces-staging --branch staging --commit-hash "$GITHUB_SHA" --commit-dirty=false
```

Never run it from the normal production-config checkout manually. Prefer the CI
job; any exceptional manual release must use a clean, disposable staging checkout,
stage its config there and pass the same isolation/migration/HEAD/build gates.
No deployment command in this document was run as part of repository preparation.

## Smoke and post-deploy checklist

```powershell
$env:SMOKE_BASE_URL = 'https://rp-doces-staging.pages.dev'
node scripts/smoke-production.mjs
```

The unchanged script uses GET only: HTML/asset, catalog, store config, unauthenticated
admin rejection and missing-route behavior. It does not test writes, external
payments, uploads or push delivery. Require:

- Correct SHA and project URL in Cloudflare and the GitHub deployment summary.
- `STAGING` badge visible in authenticated admin; absent from production builds.
- Isolated D1/R2/Queue bindings and no production endpoints/keys in staging.
- Queue producer >= 1, consumer = 1; healthy once-per-minute Worker cron.
- Test admin access and synthetic catalog/image upload work only in staging.
- Independent VAPID subscription/test notification; inspect sanitized Worker logs.
- Sandbox payment/webhook tests only where supported; no actual financial charges.
- No automatic Git integration publication outside this gated workflow.

## Safe staging reset

Do not provide generic destructive scripts. Use the Cloudflare dashboard for a
separately approved, manually reviewed reset of **`rp-doces-db-staging` only**.
First set `STAGING_DEPLOY_ENABLED=false`, stop the staging consumer/cron and isolate
staging traffic so Queue messages cannot replay against recreated IDs. Discard
staging Queue messages or recreate **only** the staging queue before resuming.
Record the current staging D1 ID and compare it with both configs and the dashboard;
require a second review that the production ID/name is not selected.

If recreating D1, update both staging IDs, apply all migrations, restore synthetic
data only, rebuild/validate bindings, redeploy the staging Worker and repeat the
schema/smoke checklist before re-enabling publication. Existing auth/push subscriptions
must be re-established. Never delete production D1/R2/Queue/Worker/Pages resources.

## Troubleshooting and local validation limits

- Placeholder rejected: insert the newly created staging D1 UUID into both configs.
- Deployment skipped: check Environment `staging` switch, branch and current HEAD.
- Missing credentials: populate all staging environment secrets; do not use repository
  production secrets as fallback. GitHub plan/environment feature availability is
  a provisioning prerequisite.
- Migration guard blocked: manually apply missing staging migrations with its explicit
  config, then retry. Never add migration application to CI.
- No badge: staging build must receive `VITE_APP_ENV=staging`; changing a server-side
  Pages variable after build cannot change the compiled bundle.
- API verifier cannot find SHA: Pages production branch must be `staging`; check the
  separate project's stable slot, token permissions and Cloudflare propagation.
- Custom domain smoke fails: keep `STAGING_URL` on Pages until DNS/TLS are ready.
- Push missing: verify the independent VAPID pair on both services, active admin,
  Queue bindings, backlog and Worker cron; do not change delivery invariants.
- Queue create fails: specify `--message-retention-period-secs 86400` explicitly.

Worker `deploy --dry-run` bundles safely without remote publication. Pages deploy
has **no dry-run** in the installed version. Pages validation is limited to local
Wrangler config parsing, binding/isolation tests and application compilation;
resource existence, account permissions and real runtime behavior require the
future manual rollout. Local validation must use an empty temporary directory
and isolated Wrangler config home to avoid reading `.dev.vars` or private credentials.
Vite validation should use a temporary `envDir` if private `.env*` files may exist.

During this change, four existing migration-guard CLI tests aborted during child
process shutdown on Node 24.19 / Windows with a native `UV_HANDLE_CLOSING`
assertion (exit 3221226505 instead of the expected blocking code). The isolated
repeat reproduced it; the guard and those tests were left unchanged. Do not treat
this local validation as fully green: rerun the unchanged suite on the CI Linux
runner and investigate the native runtime failure separately.

References: [Cloudflare Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/),
[GitHub deployment environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments),
[Mercado Pago Payments integration tests](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-payments/integration-test/make-test-purchase?scope=prod).
