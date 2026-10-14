import { expect, test, type Page } from "@playwright/test";

const destinations = [
  { hash: "cardapio", label: "Cardápio", heading: ".process-header" },
  { hash: "sobre", label: "Sobre", heading: ".story-heading-group" },
  { hash: "onde-estamos", label: "Onde estamos", heading: ".contact-header" },
  { hash: "contato", label: "Contato", heading: ".footer-brand-name" }
];

async function expectClearHeading(page: Page, selector: string) {
  // Include the longest existing reveal transition before checking the final position.
  await page.waitForTimeout(1100);
  const position = await page.locator(selector).evaluate(element => {
    const scroller = document.querySelector<HTMLElement>(".homepage-content");
    const wave = document.querySelector(".wave-container");
    if (!scroller || !wave) throw new Error("Home scroller and wave must be present");
    const rect = element.getBoundingClientRect();
    return {
      top: rect.top,
      bottom: rect.bottom,
      clearEdge: wave.getBoundingClientRect().height + 94,
      viewportHeight: innerHeight,
      outerScroll: window.scrollY,
      innerScroll: scroller.scrollTop,
      overflow: scroller.scrollWidth - scroller.clientWidth
    };
  });
  expect(position.top).toBeGreaterThanOrEqual(position.clearEdge - 1);
  expect(position.bottom).toBeLessThanOrEqual(position.viewportHeight);
  expect(position.outerScroll).toBe(0);
  expect(position.innerScroll).toBeGreaterThan(0);
  expect(position.overflow).toBe(0);
}

async function expectReadableText(page: Page) {
  const measurements = await page.evaluate(() => {
    const luminance = (color: string) => {
      const components = color.match(/[\d.]+/g);
      if (!components || components.length < 3) throw new Error(`Unsupported color: ${color}`);
      const channels = components.slice(0, 3).map(Number);
      const linear = channels.map(channel => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
    };
    const selectors = [
      ".hero-location",
      ".floating-label",
      ".section-tag",
      ".process-label",
      ".footer-col h4",
      ".footer-bottom p",
      ".footer-bottom span",
      ".main-nav a"
    ];
    return selectors.flatMap(selector =>
      [...document.querySelectorAll<HTMLElement>(`.homepage ${selector}`)]
        .filter(element => element.getClientRects().length > 0)
        .map(element => {
          let backgroundElement: HTMLElement | null = element;
          while (
            backgroundElement &&
            getComputedStyle(backgroundElement).backgroundColor === "rgba(0, 0, 0, 0)"
          ) {
            backgroundElement = backgroundElement.parentElement;
          }
          if (!backgroundElement) throw new Error(`Missing background for ${selector}`);
          const foreground = luminance(getComputedStyle(element).color);
          const background = luminance(getComputedStyle(backgroundElement).backgroundColor);
          return {
            selector,
            contrast:
              (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05)
          };
        })
    );
  });
  for (const measurement of measurements) {
    expect(measurement.contrast, measurement.selector).toBeGreaterThanOrEqual(4.5);
  }
}

for (const width of [1440, 390, 360]) {
  for (const theme of ["light", "dark"] as const) {
    test(`Home text and anchor clearance at ${width}px in ${theme} mode`, async ({ page }) => {
      await page.setViewportSize({
        width,
        height: width === 1440 ? 900 : width === 390 ? 844 : 800
      });
      await page.addInitScript(value => localStorage.setItem("store-theme", value), theme);
      // Keep the browser regression local and independent of D1 or remote maintenance calls.
      await page.route(
        url => url.pathname.startsWith("/api/"),
        route => {
          const pathname = new URL(route.request().url()).pathname;
          return route.fulfill({
            json: pathname === "/api/produtos" ? { produtos: [] } : {}
          });
        }
      );
      await page.goto("/");
      await page.locator(".hero").waitFor();
      await page.evaluate(() => document.fonts.ready);
      await expectReadableText(page);

      await page.locator(".hero-cta").click();
      await expectClearHeading(page, ".story-heading-group");

      for (const destination of destinations) {
        if (width === 1440) {
          await page.locator(`.main-nav a[href="#${destination.hash}"]`).click();
        } else {
          await page.getByRole("button", { name: "Abrir menu", exact: true }).click();
          await page.locator(".mobile-menu-link").filter({ hasText: destination.label }).click();
        }
        await expectClearHeading(page, destination.heading);
        await expectReadableText(page);
      }

      const scrollBefore = await page.locator(".homepage-content").evaluate(el => el.scrollTop);
      await page.locator(".theme-toggle-btn").click();
      await expect(page.locator("html")).toHaveAttribute(
        "data-theme",
        theme === "light" ? "dark" : "light"
      );
      await page.waitForTimeout(700);
      const scrollAfter = await page.locator(".homepage-content").evaluate(el => el.scrollTop);
      expect(Math.abs(scrollAfter - scrollBefore)).toBeLessThanOrEqual(0.5);
      await expectReadableText(page);

      for (const destination of destinations) {
        await page.goto(`/#${destination.hash}`);
        await page.locator(destination.heading).waitFor();
        await page.evaluate(() => document.fonts.ready);
        await expectClearHeading(page, destination.heading);
      }

      await page.locator(".homepage-content").evaluate(el => el.scrollTo(0, 0));
      const height = await page.locator(".homepage-content").evaluate(el => el.scrollHeight);
      for (let top = 0; top < height; top += 300) {
        await page.locator(".homepage-content").evaluate((el, y) => el.scrollTo(0, y), top);
        await page.waitForTimeout(60);
      }
      await expect(page.locator(".scroll-reveal:not(.revealed)")).toHaveCount(0);
    });
  }
}
