# Changelog

## 1.0.0 — Unreleased

Initial formal release prepared for the existing R&P Doces application. Publication date and release tag will be recorded only after release approval and deployment verification.

### Included

- Storefront with Home, product catalog and details, cart persistence, checkout, order tracking, responsive navigation, and light/dark themes.
- Administrative dashboard, product and category management, product images in R2, store settings, itemized expenses, and order management.
- Administrative authentication with session cookies, OWNER/ADMIN roles, administrator management, password verification, and protection for the last active owner.
- Orders created through the storefront or admin, manual payments, status updates, archiving, and event history.
- Stock reservation, release, deduction, and replenishment with database constraints and transactional guards.
- Mercado Pago Pix payment creation, stable operation keys, signed webhook validation, status synchronization, and recovery of inconclusive requests.
- Item exchanges, whole-line cancellations, manual and Mercado Pago refunds, payment allocations, and order annulment flows.
- Financial ledger in integer cents, idempotent replay/conflict handling, and explicit reconciliation of payment and stock states.
- Sequential Cloudflare D1 migrations and a read-only migration guard before deployment.
- Administrative Web Push subscriptions, delivery and retry, sanitized errors, and token-based renewable claim leases for abandoned-event recovery. Delivery uses at-least-once semantics; rare duplicates remain possible.
- Targeted domain/UI regression harnesses, local D1 concurrency tests, Playwright E2E, frontend/Functions typechecks, and GitHub Actions CI.
- Same-origin mutation checks, security headers, login/checkout rate limits, Dependabot updates, and production dependency auditing.
- Local D1 backup, checksum verification, normalized restore, migration/schema/constraint checks, and documented rollback procedures.
- Post-deployment SHA verification and read-only smoke checks in the deployment pipeline.
- Request correlation IDs propagated through Pages Functions and structured operational alerts in logs, without an external alert destination.

### Release conditions and known limits

- Follow the [release checklist](docs/RELEASE-CHECKLIST.md); tag convention is `v1.0.0`. Preparing this entry does not create a tag, GitHub Release, or deployment.
- Production high/critical vulnerabilities block release. Current React Router moderate findings are triaged in the [risk acceptance](docs/architecture/dependency-risk-acceptance.md); migration to React Router 7 is planned separately after v1.0.
- A disposable local backup/restore exercise recovered data and exports identically. This does not prove remote dump compatibility, production restore, or a live Pages rollback.
- Production backups, D1 migration status, a known healthy rollback deployment, CI/audit results for the release SHA, and post-deployment smoke must be confirmed by the release operator.
- Scheduled production D1 backups, R2 backups, and external observability/alert delivery are not configured.
