import { expect, test } from "@playwright/test";

for (const width of [360, 390, 412]) {
  for (const theme of ["light", "dark"] as const) {
    for (const reducedMotion of ["no-preference", "reduce"] as const) {
      test(`Learn more at ${width}px in ${theme} with ${reducedMotion}`, async ({ browser }) => {
        const context = await browser.newContext({
          baseURL: test.info().project.use.baseURL,
          viewport: { width, height: 844 },
          hasTouch: true,
          isMobile: true,
          reducedMotion
        });
        const page = await context.newPage();
        try {
          await page.addInitScript(value => localStorage.setItem("store-theme", value), theme);
          await page.route(
            url => url.pathname.startsWith("/api/"),
            route =>
              route.fulfill({
                json:
                  new URL(route.request().url()).pathname === "/api/produtos"
                    ? { produtos: [] }
                    : {}
              })
          );
          await page.goto("/");
          await page.locator(".hero-cta").waitFor();
          await page.evaluate(() => document.fonts.ready);
          const story = page.locator("#sobre");
          await expect(story).not.toHaveClass(/revealed/);
          await expect(story).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 40)");
          const initialOffset = await story.evaluate(el => (el as HTMLElement).offsetTop);
          await page.evaluate(() => {
            const scroller = document.querySelector<HTMLElement>(".homepage-content");
            const cta = document.querySelector(".hero-cta");
            if (!scroller || !cta) throw new Error("Home scroller and CTA must be present");
            const samples: number[] = [];
            (window as typeof window & { ctaScrollSamples: number[] }).ctaScrollSamples = samples;
            cta.addEventListener("click", () => {
              samples.push(scroller.scrollTop);
              const start = performance.now();
              const sample = () => {
                samples.push(scroller.scrollTop);
                if (performance.now() - start < 1200) requestAnimationFrame(sample);
              };
              requestAnimationFrame(sample);
            });
          });

          await page.locator(".hero-cta").tap();
          await expect(page).toHaveURL(/#sobre$/);
          await page.waitForTimeout(1400);
          await expect(story).toHaveClass(/revealed/);
          await expect(story).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
          expect(await story.evaluate(el => (el as HTMLElement).offsetTop)).toBe(initialOffset);
          const result = await page.evaluate(() => {
            const main = document.querySelector(".homepage-content");
            const heading = document.querySelector(".story-heading-group");
            const hero = document.querySelector(".hero");
            const wave = document.querySelector(".wave-container");
            const photo = document.querySelector(".story-image-wrapper");
            if (!main || !heading || !hero || !wave || !photo)
              throw new Error("Home sections must be present");
            return {
              positions: [
                ...new Set(
                  (window as typeof window & { ctaScrollSamples: number[] }).ctaScrollSamples
                )
              ],
              heading: heading.getBoundingClientRect().top,
              headingBottom: heading.getBoundingClientRect().bottom,
              photoTop: photo.getBoundingClientRect().top,
              photoBottom: photo.getBoundingClientRect().bottom,
              heroBottom: hero.getBoundingClientRect().bottom,
              opaqueEdge: wave.getBoundingClientRect().height - 20,
              clearEdge: wave.getBoundingClientRect().height + 94,
              viewportHeight: innerHeight,
              mask: getComputedStyle(main).maskImage,
              outerScroll: window.scrollY
            };
          });
          expect(result.positions.length).toBeGreaterThan(1);
          if (reducedMotion === "reduce") expect(result.positions.length).toBeLessThanOrEqual(2);
          else {
            expect(result.positions.length).toBeGreaterThan(3);
            const jumps = result.positions
              .slice(1)
              .map((value, index) => Math.abs(value - result.positions[index]));
            expect(Math.max(...jumps)).toBeLessThan(
              result.positions[result.positions.length - 1] / 2
            );
          }
          expect(result.heading).toBeGreaterThanOrEqual(result.clearEdge - 1);
          expect(result.heroBottom).toBeLessThanOrEqual(result.opaqueEdge + 1);
          expect(result.heroBottom).toBeGreaterThanOrEqual(result.opaqueEdge - 1);
          expect(result.photoTop - result.heroBottom).toBeGreaterThanOrEqual(23);
          expect(result.photoTop - result.heroBottom).toBeLessThanOrEqual(25);
          expect(result.photoBottom - result.clearEdge).toBeGreaterThanOrEqual(160);
          expect(result.heading - result.photoBottom).toBeGreaterThanOrEqual(23);
          expect(result.heading - result.photoBottom).toBeLessThanOrEqual(29);
          expect(result.headingBottom).toBeLessThanOrEqual(result.viewportHeight);
          expect(result.mask).toBe("none");
          expect(result.outerScroll).toBe(0);
          await page.screenshot({ path: test.info().outputPath("arrival.png") });

          const scroller = page.locator(".homepage-content");
          const firstScroll = await scroller.evaluate(el => el.scrollTop);
          await scroller.evaluate(el => el.scrollTo({ top: 0, behavior: "instant" }));
          await expect.poll(() => scroller.evaluate(el => el.scrollTop)).toBe(0);
          await page.locator(".hero-cta").tap();
          await expect(page).toHaveURL(/#sobre$/);
          await page.waitForTimeout(1400);
          await expect(story).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
          expect(
            Math.abs((await scroller.evaluate(el => el.scrollTop)) - firstScroll)
          ).toBeLessThanOrEqual(1);
          for (const [selector, firstTop] of [
            [".story-image-wrapper", result.photoTop],
            [".story-heading-group", result.heading]
          ] as const) {
            const repeatedTop = await page
              .locator(selector)
              .evaluate(el => el.getBoundingClientRect().top);
            expect(Math.abs(repeatedTop - firstTop)).toBeLessThanOrEqual(1);
          }

          await page.getByRole("button", { name: "Abrir menu", exact: true }).tap();
          await expect(
            page.locator(".mobile-menu-link").filter({ hasText: "Cardápio" })
          ).toHaveCount(0);
          await expect(page.locator('.homepage-content a[href="/cardapio"]')).toBeAttached();
          await page.locator(".mobile-menu-close").tap();
          await page.locator(".btn-cardapio").tap();
          await expect(page).toHaveURL(/\/cardapio$/);
        } finally {
          await context.close();
        }
      });
    }
  }
}
