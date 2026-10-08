# Dependency and install-script security audit

Date: 2026-10-08. Branch: `fix/dependency-security`, based on updated
`origin/staging` at `37a81ab09bc2224c4c4267e864112aa6a8303a0e`.
Environment: Windows, Node 24.19.0, npm 11.17.0.

No commit, push, merge, deployment, remote database operation or Cloudflare
resource mutation was performed. Application code and migrations are unchanged.

## CI compatibility review

The pre-commit review changes the two workflows, their regression contract and this report. The
dependency resolutions, npm engine requirement, strict npm configuration and
exact-version hook denials from the original audit are preserved.

All six npm-using jobs now select `node-version: ">=24.19.0 <25"` with
`actions/setup-node@v7`: checks, tests, e2e, production deploy, staging deploy
and dependency audit. The [v7 documentation](https://github.com/actions/setup-node/tree/v7#supported-version-syntax)
supports SemVer ranges. [Node 24.19.0](https://nodejs.org/en/blog/release/v24.19.0)
ships npm 11.17.0; bare `24` could previously select an older cached Node 24
release with an npm version that cannot enforce the reviewed hook policy.
The action's own Node 24 runtime does not select the project's Node version.

Every relevant job prints `node --version` and `npm --version` and rejects
npm below 11.17.0 before installation or audit. Deploy verification retains
the same gate condition as setup/install, so skipped deployments do not check
an unselected system Node. Both dependency-audit path filters now include
`.npmrc`; changing the security policy triggers the audit. No install step was
added to the lockfile-only audit job, and its vulnerability thresholds are
unchanged. The existing non-blocking Biome CI step is also unchanged.

Local boundary checks verified that the Node range excludes 24.18.0 and 25.0.0
and includes 24.19.0 and 24.20.0. The actual npm guard rejects 11.16.0 and accepts
11.17.0, 11.18.0 and 12.0.0. Both workflow YAML files passed Prettier parsing,
and all six npm jobs were checked for setup and verification ordering.
The exact verification step also passed in Windows Git Bash with the installed
npm and rejected a simulated 11.16.99; this is shell evidence, not Linux execution.

### Validation environment and unresolved Linux evidence

The available environment is Windows with Node 24.19.0/npm 11.17.0. WSL reports
that the subsystem is not installed; Docker and Podman are unavailable. No
Linux distribution or container host was installed. Consequently a clean
Linux installation, Linux native executable execution and a hosted GitHub
Actions run **remain unverified**. Windows results must not be interpreted as
Ubuntu 24.04 results. The workflows are configured for Ubuntu 24.04, but their
actual execution remains a pre-commit/release verification gap.

A new disposable Windows copy, without node_modules, passed
`npm ci --foreground-scripts` with both strict settings enabled and all hooks
denied. No install-script warning or lifecycle execution output appeared;
the read-only pending-hook inspection returned an empty list. Both esbuild
versions (0.21.5 and 0.28.2) executed transform operations, and both workerd
binaries (2025-07-18 and 2026-10-06) executed `--version`. That clean copy also
passed the production build and 13 real-route/disposable-D1 cutover tests.
An initial temporary binary probe incorrectly treated the workerd module
object as an executable path; using its default export resolved
the probe error, and both executables passed the repeated check.

### Regression investigation and review checks

The initial complete native run executed 2600 tests in 116 files: 2599 passed
and one failed. `staging-environment.test.mjs` freezes the full semantic
production job by SHA-256, so the requested Node range and version check
invalidated the old snapshot. A semantic comparison against HEAD confirmed
that removing only the new verification step and restoring the previous Node
selection yields exactly the original production job; deployment behavior,
secrets and gates are preserved.

The snapshot now freezes the reviewed job. New regression cases verify all six
npm jobs, setup/verification/install ordering, matching deploy conditions,
explicit version output and both `.npmrc` triggers. They execute each actual
npm guard with 11.16.99 (rejected), 11.17.0 and 12.0.0 (accepted). The affected
file passed all 49 tests after correction. The final complete run passed all
2607 tests in 116 files, with all six shards returning exit 0. Actual execution
logs were checked for exactly-once coverage of every test file.
No assertion or negative control was removed. An intermediate Biome style
finding in the new assertion was corrected with a template literal.

| Review check                                  | Result                                                                                          |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Biome                                         | Passed: 474 files, no warnings, errors or informational findings                                |
| Prettier                                      | Passed for both workflows, the regression test, package.json, package-lock.json and this report |
| Frontend/Functions typecheck                  | Passed                                                                                          |
| Playwright                                    | Passed: 11 tests with installed Windows Chrome and process-local CHROME_PATH                    |
| Production build                              | Passed in the workspace and in the clean Windows copy                                           |
| Native tests                                  | Passed: 2607 tests in 116 files; initial failure and regression correction documented above     |
| Shard coverage                                | Passed: all 116 files occur exactly once                                                        |
| Clean installation and native binaries        | Passed on Windows with npm 11.17.0; no hook approval or install-script warnings                 |
| Linux installation, binaries, build and tests | Blocked: no Linux execution environment available                                               |
| npm audit / production audit                  | Both exit 1: 8 affected packages overall, 2 moderate in production; unchanged in this review    |
| npm audit signatures                          | Blocked: exit 1/E404 for the registry attestation; metadata/endpoint mismatch reproduced        |
| git diff --check                              | Passed                                                                                          |

The Playwright process alone omitted NO_COLOR to avoid its conflict with
FORCE_COLOR; permanent environment settings and test assertions are unchanged.
Two expected PUSH_RETRY_EXHAUSTED operational WARNING alerts were emitted by
injected failure scenarios and remain visible. No React Router future-flag,
React root or JSDOM implementation warnings were observed.

The full and production audits were repeated and both returned exit 1:
8 affected packages (4 high, 4 moderate) and 2 moderate production packages,
respectively. These are unchanged from the previous corrected dependency
baseline. The React Router, Vite/esbuild and standalone Miniflare findings,
macOS/fsevents execution gap and registry-attestation failure described below
remain unresolved. This CI review does not accept those risks or migrate majors.

`npm audit signatures` was also repeated and returned exit 1/E404. Fresh
requests confirmed HTTP 200 package metadata advertises the whatwg-url@17.1.1
attestation URL while that URL returns HTTP 404. Provenance verification remains
blocked by the registry response; no attestation or security check was disabled.

Review validation logs are stored under `%TEMP%/rp-doces-ci-compatibility/`.
The first workflow formatting check reported two files; Prettier corrected
the range quoting and line endings, and the repeated check passed. The new
workflow behavior deliberately fails early on incompatible npm versions;
no application behavior, deploy gates or Cloudflare resources changed.

## Audit comparison

| Check                                             | Before                                   | After                                                                | Exit status        |
| ------------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------- | ------------------ |
| `npm audit --json`                                | 11 affected packages: 8 high, 3 moderate | 8 affected packages: 4 high, 4 moderate                              | 1 before and after |
| `npm audit --omit=dev --json`                     | 2 moderate, 0 high/critical              | 2 moderate, 0 high/critical                                          | 1 before and after |
| Pending installed lifecycle scripts               | Four installed package versions          | None                                                                 | Inspection passed  |
| `npm ci --foreground-scripts` after policy review | Not run without a policy                 | Clean installation passed; no install-script warnings or hook output | 0                  |

These counts describe affected dependency-tree nodes, not distinct advisories.
For example, `react-router-dom` inherits vulnerabilities from `react-router`.
Miniflare's reported severity changes from high to moderate after the vulnerable
Wrangler-owned instance is replaced; the remaining Miniflare 3 instance still
depends on vulnerable packages. This is not a clean security audit.

## Dependency ownership and exposure

| Dependency path                                                                | Use                                                                         | Deployment exposure                                              |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `rp-doces -> react-router-dom@6.30.6 -> react-router@6.30.6`                   | Frontend routing in production and UI tests                                 | Included in the browser application                              |
| `rp-doces -> react / react-dom / motion`                                       | Frontend rendering and animations                                           | Included in the browser application                              |
| `rp-doces -> @mmmike/web-push`                                                 | Backend Web Push encryption                                                 | Bundled into backend code; not affected by this audit            |
| `rp-doces -> vite@5.4.21 -> esbuild@0.21.5`                                    | Development server, build; the hoisted esbuild API also bundles test routes | Build/test tooling; native executable not shipped to the browser |
| `rp-doces -> vite -> postcss -> source-map-js`                                 | CSS/build source-map processing                                             | Development/build dependency                                     |
| `rp-doces -> jsdom -> css-tree -> source-map-js`                               | DOM/CSS testing                                                             | Tests only                                                       |
| `rp-doces -> miniflare@3.20250718.3 -> workerd@1.20250718.0`                   | Disposable local D1 and real-route integration tests                        | Test harness, not the deployed Cloudflare runtime                |
| `rp-doces -> miniflare@3.20250718.3 -> undici@5.29.0 -> @fastify/busboy@2.1.1` | HTTP/multipart handling in the local harness                                | Development/tests                                                |
| `rp-doces -> miniflare@3.20250718.3 -> ws@8.18.0`                              | Local harness WebSockets                                                    | Development/tests                                                |
| `rp-doces -> wrangler@4.149.0 -> esbuild@0.28.2`                               | Functions/Worker bundling, local Pages development and deploy CLI           | Runs in local/CI tooling, including deploy jobs                  |
| `rp-doces -> wrangler -> miniflare@5.20261006.1-alpha -> sharp@0.35.5`         | Local Cloudflare emulation and image tooling                                | CLI/local development, not application image-upload code         |
| `rp-doces -> wrangler / miniflare -> workerd@1.20261006.1`                     | Wrangler's local runtime                                                    | CLI/local development                                            |
| `rp-doces -> vite / wrangler -> fsevents@2.3.3`                                | Optional macOS file watching                                                | Developer tooling; absent from Windows/Linux actual trees        |
| TypeScript, Workers/React types, Biome, Prettier, Playwright                   | Compilation, checks and browser tests                                       | Build/CI/test tooling                                            |

`dev: true` in the lockfile does not make a vulnerability irrelevant: build and
deploy tools run with local or CI privileges. The production dependency audit
does not cover those tools.

## Production vulnerabilities and migration boundary

Both advisories affect `react-router@6.30.6` through the direct
`react-router-dom@6.30.6` dependency. Both are corrected starting with 7.18.0;
the observed npm recommendation is `react-router-dom@7.18.4`. No corrected v6
release was available in the registry at the time of this audit.

- [GHSA-wrjc-x8rr-h8h6 / CVE-2026-53669](https://github.com/advisories/GHSA-wrjc-x8rr-h8h6): attacker-controlled paths containing backslashes can produce unexpected external navigation through Link or useNavigate. Current routes are constants or fixed prefixes. Notification destinations are constructed in `functions/lib/notificacoes.ts` and consumed in `src/admin/notificacoes/AdminNotificacoes.tsx`; the inspected flow does not expose arbitrary user-controlled destinations. This limits current exposure but does not repair the vulnerable package.
- [GHSA-337j-9hxr-rhxg / CVE-2026-53666](https://github.com/advisories/GHSA-337j-9hxr-rhxg): unsafe constructor selection from attacker-influenced SSR error hydration. The advisory excludes Declarative Mode. `src/main.tsx` uses createRoot and `src/App.tsx` uses BrowserRouter; no SSR/hydration flow was identified. The affected dependency nevertheless remains installed and is still reported by npm.

The previous [risk acceptance](dependency-risk-acceptance.md) remains historical;
this audit does not create or renew approval for the remaining vulnerabilities.

The [official v6-to-v7 migration guide](https://reactrouter.com/7.18.4/upgrading/v6)
requires Node 20+, React 18+ and React DOM 18+, which this project satisfies.
Updated staging already enables both Declarative Mode flags,
v7_startTransition and v7_relativeSplatPath, on BrowserRouter and the inspected
MemoryRouter harnesses. The other guide flags concern Data/Framework Mode and
do not apply to this application. This reduces migration risk compared with
the historical state, but it is not a test of the new package. A major
migration still needs explicit review of:

- Navigation scheduling through startTransition and the lazy/Suspense loading
  fallback, including checkout/payment transitions and animation timing.
- Relative resolution in multi-segment splats. The existing `/admin/*` route is
  a null placeholder, but deep admin URLs, relative links, back/forward and
  route-state restoration must be verified.
- UI harnesses that still declare v6 future flags, public order-token routes,
  authentication redirects, hash navigation and notification navigation.
- Router imports and types. The declarative APIs have a compatibility path;
  moving to Framework Mode, SSR or Data Mode is unnecessary for this fix.

No React Router major migration or future-flag change was applied.
The published 7.18.4 packages have no install lifecycle hooks. Their manifest
adds cookie and set-cookie-parser under react-router, and the inspected
BrowserRouter/MemoryRouter declarations remove the old future prop. A concrete
next-stage change is to pin react-router-dom 7.18.4, regenerate the lockfile,
remove the obsolete BrowserRouter prop in App.tsx, and align the UI harnesses
without changing routing assertions. That stage must repeat routing, checkout,
order tracking, redirects, animation and full-suite validation before adoption.

## Compatible dependency corrections

- `source-map-js` 1.2.1 -> 1.2.2, within the existing consumers' `^1.2.1`
  requirement. [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q)
  covers event-loop denial of service through excessive indexed source-map
  offsets. The updated library rejects an offset of one billion lines and
  preserves normal input; an additional allowed-limit case completes without
  iterating through absent source lines.
- Wrangler 4.148.0 -> 4.149.0, staying in the existing major version. Its
  [release notes](https://github.com/cloudflare/workers-sdk/releases/tag/wrangler%404.149.0)
  include the dependency correction to sharp 0.35.5. Wrangler's Miniflare moves
  from `5.20261006.0-alpha` to `5.20261006.1-alpha`; its esbuild moves from 0.28.1
  to 0.28.2. Both workerd versions used by this project remain unchanged.
- sharp 0.35.4 -> 0.35.5 and its platform/libvips artifacts correct
  [GHSA-wq5f-xc86-pv6w](https://github.com/advisories/GHSA-wq5f-xc86-pv6w), a
  librsvg memory vulnerability that can permit RCE under affected Linux
  conditions. These are Wrangler-owned dependencies, not the production
  application's upload implementation.

The lockfile diff contains the required native artifacts for supported
platforms, not just the Windows packages. No override, forced audit fix,
dependency removal or unrelated root dependency upgrade was introduced.

## Install-script review and policy

The installed npm 11.17.0 implementation was inspected in
`lib/utils/resolve-allow-scripts.js`, `strict-allow-scripts-preflight.js` and
`@npmcli/arborist/lib/arborist/rebuild.js`.

- Without an explicit decision, scripts still execute in this release and npm
  emits an advisory warning. The warning is not evidence of a blocked script.
- A matching false decision skips lifecycle execution. Strict mode rejects
  unmatched install-script packages before reification; a future version
  outside the exact version disjunction therefore requires another review.
- CLI/environment policy has precedence; root package.json policy precedes
  the npmrc policy. Project-scoped installs reject the CLI `--allow-scripts`
  flag. Global/on-demand npx contexts have different policy resolution;
  the project policy must not be assumed to authorize arbitrary npx downloads.
- The reviewed listing command was
  `npm approve-scripts --allow-scripts-pending --json`: in this version the
  pending mode is read-only and does not approve, write or execute scripts.
- `npm install-scripts` is not a command in installed npm 11.17.0; newer online
  documentation must not be substituted for this installed implementation.

| Reviewed package/version              | Lifecycle and behavior                                                                                                                                                                                                                                                                    | Decision                                                           |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| esbuild 0.21.5                        | `node install.js`: selects optional native package, runs a version check, may rewrite wrappers/hardlink the executable, and can invoke npm or download a fallback tarball. It also accepts ESBUILD_BINARY_PATH. Its direct-download fallback lacks the newer binary-integrity protection. | Deny the hook; retain optional binary and normal API/CLI execution |
| esbuild 0.28.1 before / 0.28.2 after  | Same general installer responsibilities; the reviewed 0.28.2 implementation checks downloaded binary content against published integrity data. The downloaded 0.28.2 tarball SHA-512 matched registry metadata.                                                                           | Deny 0.28.2; no longer cover removed 0.28.1                        |
| workerd 1.20250718.0 and 1.20261006.1 | `node install.js`: resolves the optional Cloudflare binary, validates its version, optionally optimizes it, and can invoke npm or download a fallback executable. These fallbacks can execute native code with installer privileges.                                                      | Deny both hooks; retain the optional Cloudflare binaries           |
| fsevents 2.3.3                        | Lockfile marks an install script; registry manifest declares node-gyp rebuild. Strict preflight also examines this macOS-only entry on Windows. Its published tarball already contains fsevents.node and the JS loader; no compilation is required for the reviewed artifact.             | Deny this exact version; macOS execution was not validated locally |

Origins were checked against the npm registry, lockfile resolved URLs and
integrities, and the upstream esbuild, Cloudflare workerd/workers-sdk and
fsevents repositories. Relevant tarballs were fetched for inspection with
scripts disabled during **artifact retrieval only**. The actual clean npm ci
ran with the explicit deny policy and without ignore-scripts, log filtering or
dangerously-allow-all-scripts. No lifecycle script was approved.

An isolated clean installation confirmed both esbuild APIs, both workerd
binaries, a full Vite build and 13 real-route/D1 cutover tests work without
postinstall hooks. The new project npm ci then passed with foreground script
logging enabled and no hook execution output. The optional native packages must
remain installed; installations omitting optional dependencies are unsupported
by these tools and are not repaired by an unrestricted download fallback.

`.npmrc` enables engine-strict and strict-allow-scripts. `package.json` requires
npm >=11.17.0 so an older npm cannot silently ignore the reviewed policy.
There are only exact-version false decisions, with no wildcard approval.
An isolated offline preflight with an unreviewed canary package failed with
ESTRICTALLOWSCRIPTS before any package fetch or script execution.

Tradeoffs: installation-time version validation and non-Windows hardlink
optimization are no longer performed by these hooks; normal tool execution
still resolves the version-matched optional binaries. macOS/fsevents was
inspected but not executed. New hook versions intentionally fail installation
until reviewed. Old npm clients intentionally fail the engine requirement.

## Remaining development vulnerabilities

- Vite 5.4.21: optimized-source-map traversal,
  [NTLM disclosure](https://github.com/advisories/GHSA-v6wh-96g9-6wx3) through
  the Windows editor integration, and
  [file-deny bypass](https://github.com/advisories/GHSA-fx2h-pf6j-xcff) through
  alternate Windows paths. Vite 6.4.3 is the closest corrected major line for
  the observed Vite advisories, rather than blindly jumping to npm's proposed
  Vite 8.3.4. It also depends on esbuild ^0.25.0, which is beyond Vite 5's
  ^0.21.3 constraint. The project React plugin supports Vite 6 and Node 24
  satisfies its engine. Migration still requires reviewing the Vite 6
  migration guide and validating CSS/PostCSS, dependency optimization,
  development middleware, output chunks and browser behavior.
  The [Vite 6 migration guide](https://v6.vite.dev/guide/migration.html) was
  compared with the minimal React-only vite.config.ts: there is no custom
  resolver, SSR configuration, library mode, Sass dependency or separate
  PostCSS configuration. Changes to JSON defaults and CommonJS bundling still
  require output and browser regression checks before applying the major.
- esbuild 0.21.5 under Vite:
  [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99),
  corrected in 0.25.0, affects the esbuild serve API's permissive CORS. The
  inspected tests use build/transform, not serve; that does not repair the
  package or justify hiding the audit result.
- Standalone Miniflare 3 remains on undici ^5.28.5 and exactly ws 8.18.0.
  undici 6.28.1, busboy 3.2.2 and ws 8.21.0 are beyond those supported parent
  constraints. No override was added merely to make the audit pass. The npm
  recommendation replaces the parent with Miniflare 5 alpha, a major harness
  migration requiring API/options, workerd compatibility, disposal and
  disposable D1 integrity/concurrency validation. It must not be treated as
  an incidental package update.
  The inspected v5 declarations retain cf and d1Databases but no longer
  declare the d1Persist option used in both existing fixture helpers. The
  latest observed v4 release, 4.20260730.0, still pins sharp 0.35.2, so that
  closer major does not solve the complete observed dependency problem.

The complete advisory inventory below includes inherited package findings.
These remaining findings are unresolved, not newly accepted. The inspection did
not identify these development packages in application source deployments;
their local/CI exposure still matters.

## Original dependency-audit validation

- Biome: passed without warnings or errors.
- Prettier: changed JSON and this report checked; npmrc values validated with
  npm config rather than an unsupported Prettier parser.
- Frontend and Functions typechecks: passed.
- Production build: passed without warnings.
- Playwright: 11 tests passed using the installed Chrome via CHROME_PATH.
  NO_COLOR was removed only from that process to avoid a conflict with
  Playwright's FORCE_COLOR; no permanent environment setting was changed.
- Full native test suite: 2600 tests in 116 files passed, with 0 failures.
- Test logs: no React Router future-flag, React root or JSDOM implementation
  warnings were observed. No application future-flag or console changes were
  made in this branch. Expected operational logs from injected failure scenarios
  are preserved.
- Six-way shard coverage: all 116 test files occur exactly once.
- Source-map exploit regression and normal input: passed.
- Strict install policy: clean install passed; unreviewed canary rejected;
  installed pending-script list empty.
  An additional exact-version canary rejected simulated esbuild 0.28.3, and
  an incompatible npm engine requirement was rejected with EBADENGINE.
- git diff --check: passed.
- npm audit full and production: exit 1 with the remaining findings above.
- npm audit signatures: **blocked**, exit 1. Registry metadata advertises
  `https://registry.npmjs.org/-/npm/v1/attestations/whatwg-url@17.1.1`, but a
  direct request returns HTTP 404 while package metadata returns HTTP 200.
  This pre-existing JSDOM dependency was not changed. Full provenance
  verification is incomplete; no check or attestation setting was disabled.

Raw before/after audit snapshots, script inspection, isolated installations,
registry-response evidence and validation logs are stored under
`%TEMP%/rp-doces-dependency-security/` for this session. No secrets were copied
into this report.

## Files changed

| File                                           | Purpose                                                                                                        |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| package.json                                   | Raise the compatible Wrangler minimum; require policy-capable npm; record reviewed exact-version hook denials  |
| package-lock.json                              | Resolve source-map-js and Wrangler's corrected transitive/native artifacts                                     |
| .npmrc                                         | Enforce engine compatibility and fail closed on unreviewed lifecycle scripts                                   |
| .github/workflows/ci.yml                       | Select policy-compatible Node/npm in every npm job and verify versions before installation                     |
| .github/workflows/dependency-audit.yml         | Select and verify compatible Node/npm; trigger auditing when .npmrc changes                                    |
| tests/staging-environment.test.mjs             | Freeze the reviewed production job; exercise minimum npm rejection and verify all npm jobs and policy triggers |
| docs/architecture/dependency-security-audit.md | Record findings, decisions, compatibility limits, validation and unresolved risk                               |

## Complete npm finding inventory

| Package          | Before version(s) / severity            | After version(s) / severity | Affected paths in baseline                                           |
| ---------------- | --------------------------------------- | --------------------------- | -------------------------------------------------------------------- |
| @fastify/busboy  | 2.1.1 / high                            | 2.1.1 / high                | node_modules/@fastify/busboy                                         |
| esbuild          | 0.21.5 / moderate                       | 0.21.5 / moderate           | node_modules/esbuild                                                 |
| miniflare        | 3.20250718.3, 5.20261006.0-alpha / high | 3.20250718.3 / moderate     | node_modules/miniflare; node_modules/wrangler/node_modules/miniflare |
| react-router     | 6.30.6 / moderate                       | 6.30.6 / moderate           | node_modules/react-router                                            |
| react-router-dom | 6.30.6 / moderate                       | 6.30.6 / moderate           | node_modules/react-router-dom                                        |
| sharp            | 0.35.4 / high                           | Finding removed             | node_modules/sharp                                                   |
| source-map-js    | 1.2.1 / high                            | Finding removed             | node_modules/source-map-js                                           |
| undici           | 5.29.0 / high                           | 5.29.0 / high               | node_modules/undici                                                  |
| vite             | 5.4.21 / high                           | 5.4.21 / high               | node_modules/vite                                                    |
| wrangler         | 4.148.0 / high                          | Finding removed             | node_modules/wrangler                                                |
| ws               | 8.18.0 / high                           | 8.18.0 / high               | node_modules/ws                                                      |

| Advisory / root cause                                                                                                                                                                     | Affected package and observed range | Corrected version           | State      |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | --------------------------- | ---------- |
| [@fastify/busboy vulnerable to Denial of Service via prototype-named multipart part header](https://github.com/advisories/GHSA-x8mw-p69m-v3mx)                                            | @fastify/busboy: >=1.0.0 <3.2.1     | 3.2.1                       | Unresolved |
| [@fastify/busboy vulnerable to CRLF injection via multipart Content-Disposition filename and name](https://github.com/advisories/GHSA-gxm5-99cw-xjw9)                                     | @fastify/busboy: <3.2.2             | 3.2.2                       | Unresolved |
| [esbuild enables any website to send any requests to the development server and read the response](https://github.com/advisories/GHSA-67mh-4wv8-2f99)                                     | esbuild: <=0.24.2                   | 0.25.0                      | Unresolved |
| [React Router: Open redirect via backslash in <Link> and useNavigate (CVE-2025-68470 bypass)](https://github.com/advisories/GHSA-wrjc-x8rr-h8h6)                                          | react-router: >=6.0.0 <7.18.0       | 7.18.0                      | Unresolved |
| [React Router: Arbitrary Constructor Injection via deserializeErrors() in React Router SSR Hydration](https://github.com/advisories/GHSA-337j-9hxr-rhxg)                                  | react-router: >=6.4.0 <7.18.0       | 7.18.0                      | Unresolved |
| [sharp : Vulnerability in librsvg dependency CVE-2026-96889](https://github.com/advisories/GHSA-wq5f-xc86-pv6w)                                                                           | sharp: <0.35.5                      | 0.35.5                      | Corrected  |
| [source-map-js allows event-loop denial of service through indexed source-map section offsets](https://github.com/advisories/GHSA-68fv-2mgg-jv7q)                                         | source-map-js: >=1.0.0 <1.2.2       | 1.2.2                       | Corrected  |
| [Undici has an unbounded decompression chain in HTTP responses on Node.js Fetch API via Content-Encoding leads to resource exhaustion](https://github.com/advisories/GHSA-g9mf-h72j-4rw9) | undici: <6.23.0                     | 6.23.0                      | Unresolved |
| [Undici has an HTTP Request/Response Smuggling issue](https://github.com/advisories/GHSA-2mjp-6q6p-2qxm)                                                                                  | undici: <6.24.0                     | 6.24.0                      | Unresolved |
| [Undici has Unbounded Memory Consumption in WebSocket permessage-deflate Decompression](https://github.com/advisories/GHSA-vrm6-8vpv-qv8q)                                                | undici: <6.24.0                     | 6.24.0                      | Unresolved |
| [Undici has Unhandled Exception in WebSocket Client Due to Invalid server_max_window_bits Validation](https://github.com/advisories/GHSA-v9p9-hfj2-hcw8)                                  | undici: <6.24.0                     | 6.24.0                      | Unresolved |
| [Undici has CRLF Injection in undici via `upgrade` option](https://github.com/advisories/GHSA-4992-7rv2-5pvq)                                                                             | undici: <6.24.0                     | 6.24.0                      | Unresolved |
| [undici vulnerable to HTTP header injection via Set-Cookie percent-decoding](https://github.com/advisories/GHSA-p88m-4jfj-68fv)                                                           | undici: <6.27.0                     | 6.27.0                      | Unresolved |
| [undici WebSocket client vulnerable to denial of service via fragment count bypass](https://github.com/advisories/GHSA-vxpw-j846-p89q)                                                    | undici: <6.27.0                     | 6.27.0                      | Unresolved |
| [undici vulnerable to Set-Cookie SameSite attribute downgrade via permissive substring matching](https://github.com/advisories/GHSA-g8m3-5g58-fq7m)                                       | undici: <6.27.0                     | 6.27.0                      | Unresolved |
| [undici vulnerable to downstream response desynchronization via retry interceptor](https://github.com/advisories/GHSA-8xcm-r25x-g524)                                                     | undici: <6.28.0                     | 6.28.0                      | Unresolved |
| [undici vulnerable to CRLF Injection via blob-like body 'type' property](https://github.com/advisories/GHSA-m8rv-5g2x-5cg5)                                                               | undici: <6.28.0                     | 6.28.0                      | Unresolved |
| [undici vulnerable to cookie attribute injection via unsanitized domain and unparsed setCookie fields](https://github.com/advisories/GHSA-v3r7-h72x-cjcm)                                 | undici: <6.28.0                     | 6.28.0                      | Unresolved |
| [undici vulnerable to HTTP response queue poisoning via keep-alive socket reuse](https://github.com/advisories/GHSA-35p6-xmwp-9g52)                                                       | undici: <6.27.0                     | 6.27.0                      | Unresolved |
| [undici vulnerable to downstream response splitting via retry interceptor](https://github.com/advisories/GHSA-r53p-7pc4-xj5r)                                                             | undici: <6.28.1                     | 6.28.1                      | Unresolved |
| [Vite Vulnerable to Path Traversal in Optimized Deps `.map` Handling](https://github.com/advisories/GHSA-4w7w-66w2-5vf9)                                                                  | vite: <=6.4.1                       | 6.4.2 (also 7.3.2 / 8.0.5)  | Unresolved |
| [launch-editor: NTLMv2 hash disclosure via UNC path handling on Windows](https://github.com/advisories/GHSA-v6wh-96g9-6wx3)                                                               | vite: <=6.4.2                       | 6.4.3 (also 7.3.5 / 8.0.16) | Unresolved |
| [vite: `server.fs.deny` bypass on Windows alternate paths](https://github.com/advisories/GHSA-fx2h-pf6j-xcff)                                                                             | vite: <=6.4.2                       | 6.4.3 (also 7.3.5 / 8.0.16) | Unresolved |
| [ws: Uninitialized memory disclosure](https://github.com/advisories/GHSA-58qx-3vcg-4xpx)                                                                                                  | ws: >=8.0.0 <8.20.1                 | 8.20.1                      | Unresolved |
| [ws: Memory exhaustion DoS from tiny fragments and data chunks](https://github.com/advisories/GHSA-96hv-2xvq-fx4p)                                                                        | ws: >=8.0.0 <8.21.0                 | 8.21.0                      | Unresolved |
