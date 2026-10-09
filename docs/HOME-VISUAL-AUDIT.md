# On-demand Home visual audit

Run from the repository root after installing the project's dependencies and Playwright Chromium:

```sh
npm run audit:home
npx playwright show-report playwright-report/home-visual-audit
```

The existing Playwright configuration starts local Vite at `http://127.0.0.1:5173`, or reuses a local server. This command forces the local origin even when `BASE_URL` points elsewhere. It selects `@home-visual-audit`; normal `npm run test:e2e` and CI discovery exclude this spec. No workflow changes are needed. `CHROME_PATH` remains supported, but use the same bundled Chromium version for comparisons.

Run `npm run typecheck:home-audit` to check the spec, fixtures and Playwright configuration with strict TypeScript. The normal frontend/functions typechecks exclude these files, and Playwright transpiles without typechecking. The pinned development-only `@types/node` dependency supplies Node and Playwright types; it adds no production runtime dependency.

## Coverage and evidence

The six cases cover desktop (1440×900, mouse), tablet (820×900, touch) and mobile (390×844, mobile/touch emulation), each in light and dark themes, at device scale factor 1. Three additional cases verify missing font faces, isolation with unexpected requests/navigation/WebSockets, and redirect rejection using a disposable loopback server whose redirect target must receive zero requests.

Each case captures ordinary viewport PNGs at explicit positions of `.homepage-content`, covering Hero, Story, Process, gallery, Contact and footer. Taller sections receive multiple positions. Requested and actual scroll positions are recorded; positions near the bottom can clamp to the same actual position. Images are never stitched and locator screenshots never expand the fixed scroller. The existing fade remains visible.

Playwright's native HTML report contains:

- Named viewport PNG attachments for human review.
- `reproduction`: Git HEAD and working-tree status, viewport/input profile, theme, Chromium and Node versions, fixture version and asset hashes, scroll positions, measurements and PNG SHA-256 hashes.
- `network-ledger`: every intercepted HTTP request and WebSocket, with its disposition, also attached on failure.
- Separate execution and visual-diagnostics steps. Overflow, broken or pending images, unrevealed content and wrong theme fail explicit assertions; unexpected requests and JavaScript errors are execution failures.

Artifacts stay in ignored `test-results/home-visual-audit` and `playwright-report/home-visual-audit`. The native JSON report is `test-results/home-visual-audit/results.json`; reproduction and network attachments are available there as base64 bodies. Each run replaces these folders' previous evidence. Copy the report to another ignored directory before rerunning if comparing hashes or retaining evidence. Share only the intended report: working-tree status includes local filenames, although no credentials or file contents are collected.

## Isolation and determinism

The auto fixture installs routes before navigation and blocks service workers. Only navigation to the local Home is allowed; existing local Vite modules and explicitly listed assets are fetched without following redirects, then fulfilled locally. Redirect responses are aborted because browser redirects after `route.continue()` bypass interception. Catalog/config/gallery are synthetic; the Home's reservation reconciliation POST receives a synthetic success response inside Playwright and never reaches a backend. Other APIs, mutations, external assets and unknown routes are aborted. All WebSockets are closed without connecting to a server; only the expected local HMR socket is classified as mocked. No credentials, remote database, payment services or external network availability are required.

Google's font stylesheet request is fulfilled locally with bundled licensed fonts. Gallery images reuse two checked-in WebP assets with deterministic product records. Fixture changes require updating `FIXTURE_VERSION` and reviewing evidence. When adding a legitimate new asset or API, extend the narrow route list deliberately; never replace it with a blanket passthrough.

The audit loads fonts, decodes images, walks the real scroller to finish reveals and waits for stable geometry over consecutive animation frames. Reduced motion, audit-only injected CSS and paused SVG animation remove time-dependent screenshot differences. Production files are not changed. There are no fixed sleep delays, retries or golden-image baselines.

## Limits and existing tests

Passing assertions do not approve layout, contrast or aesthetics: inspect the PNG attachments. Rendering and PNG hashes can differ across operating systems, browsers and font rasterizers; compare repeated runs in the same environment first. Synthetic data does not cover every production content length or image aspect ratio. Mobile emulation is not a physical Android device.

This static audit deliberately does not measure animation smoothness, physical 60/165 Hz displays, touch hardware or live services. Existing `home-fade`, `home-legibility-anchors`, `home-menu-focus` and `theme-transition` specs remain responsible for behavioral regressions. The original `rp-doces-visual-audit.mjs` is preserved during review; the replacement needs neither its standalone runner nor `sharp`/long-image composition.

Maintenance consists of intentional API/asset allowlist updates, synthetic fixtures and reviewing native Playwright evidence. Runtime is six sequential local visual cases plus three negative controls; report the measured duration for the particular browser/machine rather than assuming a CI timing.
