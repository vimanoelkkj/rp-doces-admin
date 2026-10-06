# Dependency risk acceptance for v1.0

## Scope and baseline

Accepted for v1.0 by the project owner on 2026-10-06, based on the production dependency audit and source inspection performed that day.

- Command: `npm audit --omit=dev`.
- Result: **2 moderate, 0 high, 0 critical** vulnerabilities.
- Installed versions match the lockfile: `rp-doces` → `react-router-dom@6.30.6` → `react-router@6.30.6`.
- The audit counts two affected packages; both point to the two React Router advisories below. The acceptance does not cover future advisories or architecture changes.

## External redirect: accepted risk for v1.0

**[GHSA-wrjc-x8rr-h8h6 / CVE-2026-53669](https://github.com/advisories/GHSA-wrjc-x8rr-h8h6)** — moderate severity.

Attacker-supplied navigation paths containing backslashes can cause unexpected external redirects. The application uses affected APIs (`Link` and `useNavigate`), but no destination completely controlled by a user was identified in the inspected flows.

Navigation uses constant routes, paths with a fixed `/pedido/` prefix, and constant Home hashes. The dynamic `navigate(notificacao.destino)` in `src/admin/notificacoes/AdminNotificacoes.tsx` receives destinations constructed by `functions/lib/notificacoes.ts`, such as `/admin/pedidos?pedido=<id>` and `/admin/produtos`, rather than user-supplied URLs.

**Decision: acceptable for v1.0 with documented risk.** The vulnerable dependency remains installed. Source inspection did not identify an exploitable input path; this is not a universal proof that exploitation is impossible.

Reassess before introducing `returnTo`, free-form URLs, or navigation destinations supplied by users or other untrusted sources.

## SSR hydration constructor injection: currently not applicable

**[GHSA-337j-9hxr-rhxg / CVE-2026-53666](https://github.com/advisories/GHSA-337j-9hxr-rhxg)** — moderate severity.

The vulnerability depends on SSR/hydration error data allowing attacker input to select client-side constructors. The advisory explicitly excludes Declarative Mode applications.

The project uses `createRoot` in `src/main.tsx` and `BrowserRouter` in `src/App.tsx`. Production source inspection found no SSR, `hydrateRoot`, `RouterProvider`, or `StaticRouter`.

**Decision: not applicable to the current architecture.** Reassess before adopting SSR, hydration, Framework Mode, or Data Mode with manual SSR/hydration.

## Remediation and release policy

Both advisories are fixed starting with React Router **7.18.0**; the audited npm recommendation is **7.18.4**. The installed v6 release remains affected, so dependency remediation requires a **major upgrade to React Router 7**. That migration will be handled separately after v1.0, with routing, checkout, admin navigation, redirects, and order tracking regression checks.

Do not use `npm audit fix --force` as a remediation shortcut. This acceptance does not authorize dependency changes.

- Production **high/critical** vulnerabilities block release.
- Production **moderate** vulnerabilities require triage and, when applicable, explicit documented risk acceptance for the release.
- Recheck the audit for each release; this dated acceptance cannot replace current triage.

See the [release checklist](../RELEASE-CHECKLIST.md) for the release gate.
