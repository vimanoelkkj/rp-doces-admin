import { test as base, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import {
  AUDIT_ORIGIN,
  FIXTURE_VERSION,
  fixtureHashes,
  fulfillLocalAsset,
  isolateHomeAudit,
  type AuditRequest
} from "./fixtures/home-visual-audit/network";

const test = base.extend<{ auditRequests: AuditRequest[] }>({
  auditRequests: [
    async ({ context, baseURL }, use, testInfo) => {
      expect(baseURL, "The audit only permits the local Vite origin").toBe(AUDIT_ORIGIN);
      const requests = await isolateHomeAudit(context);
      try {
        await use(requests);
      } finally {
        await testInfo.attach("network-ledger", {
          body: JSON.stringify(requests, null, 2),
          contentType: "application/json"
        });
      }
    },
    { auto: true }
  ]
});

const views = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 820, height: 900 },
  { name: "mobile", width: 390, height: 844 }
];
const sections = [
  ".hero",
  ".story-section",
  ".process-section",
  ".instagram-section",
  ".contact-section",
  ".footer"
];

async function prepareHome(page: Page) {
  await page.goto("/");
  await page.locator(".hero").waitFor();
  await expect(page.locator(".instagram-gallery img")).toHaveCount(5);
  await expect(page.locator(".homepage-content .scroll-reveal")).not.toHaveCount(0);
  const loadedFonts = await page.evaluate(async () => {
    const faces = await Promise.all([
      document.fonts.load('600 36px "Fraunces"'),
      document.fonts.load('italic 600 36px "Fraunces"'),
      document.fonts.load('400 16px "Manrope"')
    ]);
    await document.fonts.ready;
    return faces.map(group => group.length > 0 && group.every(face => face.status === "loaded"));
  });
  expect(loadedFonts, "Offline fonts must load; fallback fonts are not audit evidence").toEqual([
    true,
    true,
    true
  ]);
  // Only the audit browser is changed: production CSS and the fade remain untouched.
  await page.addStyleTag({
    content: "*, *::before, *::after { animation: none !important; transition: none !important; }"
  });
  await page.evaluate(() => {
    for (const svg of document.querySelectorAll("svg")) {
      svg.pauseAnimations();
      svg.setCurrentTime(0);
    }
  });
  const scroller = page.locator(".homepage-content");
  const bounds = await scroller.evaluate(el => ({
    max: el.scrollHeight - el.clientHeight,
    step: Math.floor(el.clientHeight / 2)
  }));
  for (let top = 0; top <= bounds.max + bounds.step; top += bounds.step) {
    await scroller.evaluate((el, y) => el.scrollTo({ top: y, behavior: "instant" }), top);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
  }
  await expect(
    page.locator(".homepage-content .scroll-reveal:not(.revealed)"),
    "Pending reveal state"
  ).toHaveCount(0);
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            [...document.querySelectorAll<HTMLImageElement>(".homepage-content img")].filter(
              img => img.getClientRects().length && !img.complete
            ).length
        ),
      { message: "Visible images must finish loading" }
    )
    .toBe(0);
  await page.evaluate(async () => {
    const images = [...document.querySelectorAll<HTMLImageElement>(".homepage-content img")].filter(
      img => img.getClientRects().length
    );
    await Promise.all(images.filter(img => img.naturalWidth > 0).map(img => img.decode()));
  });
}

async function settleAt(page: Page, top: number) {
  await page
    .locator(".homepage-content")
    .evaluate((el, y) => el.scrollTo({ top: y, behavior: "instant" }), top);
  await page.waitForFunction(
    () => {
      const sample = JSON.stringify(
        [
          ...document.querySelectorAll(
            ".homepage-content, .hero, .story-section, .process-section, .instagram-section, .contact-section, .footer"
          )
        ].map(el => {
          const r = el.getBoundingClientRect();
          return [r.x, r.y, r.width, r.height];
        })
      );
      const state = window as typeof window & {
        __auditLayout?: { sample: string; stable: number };
      };
      const previous = state.__auditLayout;
      state.__auditLayout = {
        sample,
        stable: previous?.sample === sample ? previous.stable + 1 : 0
      };
      return state.__auditLayout.stable >= 3;
    },
    undefined,
    { polling: "raf" }
  );
}

test.describe("Home evidence @home-visual-audit", () => {
  // Worker processes reload config without the CLI grep arguments; pin the fixture origin too.
  test.use({
    baseURL: AUDIT_ORIGIN,
    serviceWorkers: "block",
    reducedMotion: "reduce",
    deviceScaleFactor: 1
  });

  for (const view of views) {
    test.describe(view.name, () => {
      test.use({
        viewport: { width: view.width, height: view.height },
        isMobile: view.name === "mobile",
        hasTouch: view.name !== "desktop"
      });
      for (const theme of ["light", "dark"] as const) {
        test(`${view.name} ${theme}: deterministic viewport evidence`, async ({
          page,
          browser,
          auditRequests
        }, testInfo) => {
          await page.emulateMedia({ colorScheme: theme });
          await page.addInitScript(value => localStorage.setItem("store-theme", value), theme);
          const errors: string[] = [];
          page.on("pageerror", error => errors.push(error.message));
          await test.step("Execution: isolated fixtures, fonts and images", async () => {
            await prepareHome(page);
            expect(
              auditRequests.filter(r => r.action === "blocked"),
              "Unexpected requests are execution failures"
            ).toEqual([]);
            expect(errors, "JavaScript execution errors").toEqual([]);
          });
          const positions = await page.evaluate(selectors => {
            const scroller = document.querySelector<HTMLElement>(".homepage-content");
            const home = document.querySelector(".homepage");
            if (!scroller || !home) throw new Error("Home scroller must exist");
            const clearance = Number.parseFloat(getComputedStyle(home, "::after").height);
            const available = scroller.clientHeight - clearance;
            return selectors.flatMap((selector, index) => {
              const el = document.querySelector(selector);
              if (!el) throw new Error(`Missing section ${selector}`);
              const rect = el.getBoundingClientRect();
              const start = Math.max(0, rect.top + scroller.scrollTop - clearance);
              const offsets = index === 0 ? [0] : [start];
              for (
                let offset = start + available;
                offset < start + rect.height;
                offset += available
              )
                offsets.push(offset);
              return offsets.map((top, part) => ({ name: `${selector.slice(1)}-${part}`, top }));
            });
          }, sections);
          const captures = [];
          for (const position of positions) {
            await settleAt(page, position.top);
            const metrics = await page.evaluate(() => {
              const scroller = document.querySelector<HTMLElement>(".homepage-content");
              if (!scroller) throw new Error("Home scroller must exist");
              return {
                scrollTop: scroller.scrollTop,
                rootOverflow: document.documentElement.scrollWidth - innerWidth,
                scrollerOverflow: scroller.scrollWidth - scroller.clientWidth,
                brokenImages: [
                  ...document.querySelectorAll<HTMLImageElement>(".homepage-content img")
                ]
                  .filter(img => img.complete && img.naturalWidth === 0)
                  .map(img => img.alt),
                pendingImages: [
                  ...document.querySelectorAll<HTMLImageElement>(".homepage-content img")
                ]
                  .filter(img => img.getClientRects().length && !img.complete)
                  .map(img => img.alt),
                pendingReveals: document.querySelectorAll(
                  ".homepage-content .scroll-reveal:not(.revealed)"
                ).length,
                theme: document.documentElement.dataset.theme
              };
            });
            const png = await page.screenshot({ animations: "disabled" });
            await testInfo.attach(position.name, { body: png, contentType: "image/png" });
            captures.push({
              ...position,
              metrics,
              pngSha256: createHash("sha256").update(png).digest("hex")
            });
          }
          await testInfo.attach("reproduction", {
            body: JSON.stringify(
              {
                commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
                workingTree: execFileSync("git", ["status", "--porcelain"], {
                  encoding: "utf8"
                }).trim(),
                viewport: view,
                input: { isMobile: view.name === "mobile", hasTouch: view.name !== "desktop" },
                theme,
                browser: browser.version(),
                node: process.version,
                fixtureVersion: FIXTURE_VERSION,
                fixtureHashes,
                motion: "reduced; CSS transitions/animations disabled; SMIL time zero",
                captures
              },
              null,
              2
            ),
            contentType: "application/json"
          });
          testInfo.annotations.push({
            type: "visual-review",
            description:
              "Viewport PNGs are human-review evidence, not golden-image comparisons or refresh-rate tests."
          });
          const completedCaptures = [...captures];
          await test.step("Visual diagnostics: explicit assertions", async () => {
            for (const capture of completedCaptures) {
              expect.soft(capture.metrics.rootOverflow, capture.name).toBe(0);
              expect.soft(capture.metrics.scrollerOverflow, capture.name).toBe(0);
              expect.soft(capture.metrics.brokenImages, capture.name).toEqual([]);
              expect.soft(capture.metrics.pendingImages, capture.name).toEqual([]);
              expect.soft(capture.metrics.pendingReveals, capture.name).toBe(0);
              expect.soft(capture.metrics.theme, capture.name).toBe(theme);
            }
            expect(auditRequests.filter(r => r.action === "blocked")).toEqual([]);
            expect(errors).toEqual([]);
          });
        });
      }
    });
  }

  test("redirect control: an allowed asset cannot forward requests to its redirect target", async ({
    context
  }) => {
    let unexpectedHits = 0;
    const server = createServer((request, response) => {
      if (request.url === "/allowed") response.writeHead(302, { Location: "/unexpected" });
      else unexpectedHits++;
      response.end();
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Expected a loopback test port");
      const url = `http://127.0.0.1:${address.port}/allowed`;
      const actions: AuditRequest["action"][] = [];
      await context.route(url, route => fulfillLocalAsset(route, action => actions.push(action)));
      const page = await context.newPage();
      await expect(page.goto(url)).rejects.toThrow();
      expect(actions).toEqual(["blocked"]);
      expect(unexpectedHits, "Redirect target must not receive even one request").toBe(0);
      await page.close();
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close(error => (error ? reject(error) : resolve()))
      );
    }
  });

  test("font control: missing offline faces cannot silently use fallbacks", async ({
    page,
    context
  }) => {
    await context.route("https://fonts.googleapis.com/**", route =>
      route.fulfill({ contentType: "text/css", body: "/* intentionally missing font faces */" })
    );
    await expect(prepareHome(page)).rejects.toThrow(/Offline fonts must load/);
  });

  test("security controls: unexpected network requests never reach a server", async ({
    page,
    auditRequests
  }) => {
    await page.goto("/");
    await page.locator(".hero").waitFor();
    const probes = [
      { url: `${AUDIT_ORIGIN}/api/config`, method: "PUT" },
      { url: `${AUDIT_ORIGIN}/api/pagamentos`, method: "POST" },
      { url: `${AUDIT_ORIGIN}/api/reservas/reconciliar`, method: "GET" },
      { url: `${AUDIT_ORIGIN}/unexpected`, method: "GET" },
      { url: `${AUDIT_ORIGIN}/src/__audit_unknown__.tsx`, method: "GET" },
      { url: "https://example.invalid/api/reservas/reconciliar", method: "POST" },
      { url: "https://example.invalid/image.png", method: "GET" }
    ];
    const result = await page.evaluate(
      async requests =>
        Promise.all(
          requests.map(async request => {
            try {
              await fetch(request.url, { method: request.method });
              return "allowed";
            } catch {
              return "blocked";
            }
          })
        ),
      probes
    );
    expect(result).toEqual(probes.map(() => "blocked"));
    await page.evaluate(
      () =>
        new Promise<void>(resolve => {
          const socket = new WebSocket("wss://example.invalid/audit");
          socket.onclose = () => resolve();
          socket.onerror = () => resolve();
        })
    );
    expect(auditRequests).toContainEqual({
      method: "WEBSOCKET",
      url: "wss://example.invalid/audit",
      action: "blocked"
    });
    expect(
      auditRequests.filter(r => r.action === "blocked").map(({ url, method }) => ({ url, method }))
    ).toEqual(expect.arrayContaining(probes));
    expect(
      auditRequests
        .filter(r => r.method === "POST" && r.action !== "blocked")
        .every(
          r => r.action === "mocked" && new URL(r.url).pathname === "/api/reservas/reconciliar"
        )
    ).toBe(true);
    expect(auditRequests).toContainEqual({
      method: "POST",
      url: `${AUDIT_ORIGIN}/api/reservas/reconciliar`,
      action: "mocked"
    });
    for (const url of [
      `${AUDIT_ORIGIN}/src/main.tsx`,
      "https://fonts.googleapis.com/css2?family=Unexpected",
      "https://example.invalid/audit-navigation"
    ]) {
      const navigationPage = await page.context().newPage();
      await expect(
        navigationPage.goto(url),
        "Unexpected navigation must be aborted"
      ).rejects.toThrow();
      expect(auditRequests).toContainEqual({ method: "GET", url, action: "blocked" });
      await navigationPage.close();
    }
  });
});
