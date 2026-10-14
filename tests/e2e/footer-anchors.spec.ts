import { expect, test, type Page } from "@playwright/test";
import {
  expectAnchorAligned,
  mockStorefrontApi,
  readHistory,
  readScrollTop,
  recordScrollCalls,
  startScrollTrace,
  takeClickDefaults,
  takeNavigationScrolls,
  takeScrollTrace,
  trackClickDefaults,
  waitForScrollSettled
} from "./support/home-navigation";

const footerLink = (page: Page, label: string) => page.locator(".footer-col a", { hasText: label });

const sections = [
  { label: "Cardápio", hash: "cardapio" },
  { label: "Nossa História", hash: "sobre" },
  { label: "Onde estamos", hash: "onde-estamos" }
];

async function openPage(page: Page, path: string, ready: string) {
  await mockStorefrontApi(page);
  await recordScrollCalls(page);
  await page.goto(path);
  await page.locator(ready).waitFor();
  await page.evaluate(() => document.fonts.ready);
}

// The footer link columns are hidden up to 768px, so the viewports start at tablet width.
for (const [name, viewport, touch] of [
  ["desktop", { width: 1280, height: 800 }, false],
  ["tablet", { width: 820, height: 1100 }, true]
] as const) {
  test.describe(`Footer links from another page (${name})`, () => {
    test.use({ viewport, isMobile: touch, hasTouch: touch });

    for (const { label, hash } of sections) {
      test(`"${label}" on /cardapio opens the Home section`, async ({ page }) => {
        await openPage(page, "/cardapio", ".filter-tabs");
        const link = footerLink(page, label);
        await expect(link).toHaveAttribute("href", `/#${hash}`);
        const initial = await readHistory(page);

        await link.click();
        await expect(page).toHaveURL(new RegExp(`/#${hash}$`));
        await expect(page.locator(".homepage-content")).toBeVisible();
        await waitForScrollSettled(page, 600);
        await expectAnchorAligned(page, hash);
        expect(await takeNavigationScrolls(page)).toHaveLength(1);
        expect((await readHistory(page)).length).toBe(initial.length + 1);

        await page.goBack();
        await expect(page).toHaveURL(/\/cardapio$/);
        await page.goForward();
        await expect(page).toHaveURL(new RegExp(`/#${hash}$`));
        await expect(page.locator(".homepage-content")).toBeVisible();
        await waitForScrollSettled(page, 600);
        await expectAnchorAligned(page, hash);
      });
    }
  });
}

test.describe("Footer links on the Home (desktop)", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  for (const { label, hash } of sections) {
    test(`"${label}" scrolls smoothly once, aligned, with one history entry`, async ({ page }) => {
      await openPage(page, "/", ".hero");
      await expect(footerLink(page, label)).toHaveAttribute("href", `#${hash}`);
      const initial = await readHistory(page);
      await startScrollTrace(page);
      await takeScrollTrace(page);
      await takeNavigationScrolls(page);

      await footerLink(page, label).click();
      await expect(page).toHaveURL(new RegExp(`/#${hash}$`));
      await waitForScrollSettled(page);
      const trace = await takeScrollTrace(page);
      expect(trace.length).toBeGreaterThan(4);
      await expectAnchorAligned(page, hash);
      expect(await takeNavigationScrolls(page)).toHaveLength(1);

      const first = await readHistory(page);
      expect(first.length).toBe(initial.length + 1);
      expect(first.state?.idx).toBe((initial.state?.idx ?? 0) + 1);

      await footerLink(page, label).click();
      await waitForScrollSettled(page);
      expect((await readHistory(page)).length).toBe(first.length);
    });
  }

  test("Ctrl/Cmd+click is left to the browser and leaves this page untouched", async ({ page }) => {
    await openPage(page, "/", ".hero");
    const link = footerLink(page, "Nossa História");
    await link.scrollIntoViewIfNeeded();
    await waitForScrollSettled(page);
    const before = await readHistory(page);
    const scrollTop = await readScrollTop(page);
    await trackClickDefaults(page);

    await link.click({ modifiers: ["ControlOrMeta"] });
    expect(await takeClickDefaults(page)).toEqual([false]);
    await waitForScrollSettled(page);
    expect(await readHistory(page)).toEqual(before);
    expect(await readScrollTop(page)).toBe(scrollTop);
    // What the browser opens in the new tab: the section of the Home.
    const target = await link.evaluate(anchor => {
      const url = new URL((anchor as HTMLAnchorElement).href);
      return url.pathname + url.hash;
    });
    expect(target).toBe("/#sobre");

    // Control: the Router handles a plain click, so the probe does see it cancelled.
    await link.click();
    expect(await takeClickDefaults(page)).toEqual([true]);
  });
});

test.describe("Footer links with reduced motion", () => {
  test.use({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });

  test("jump straight to the Home section", async ({ page }) => {
    await openPage(page, "/", ".hero");
    // Playwright scrolls the link into view before clicking; do that before sampling.
    await footerLink(page, "Nossa História").scrollIntoViewIfNeeded();
    await waitForScrollSettled(page);
    await startScrollTrace(page);
    await takeScrollTrace(page);

    await footerLink(page, "Nossa História").click();
    await waitForScrollSettled(page);
    expect((await takeScrollTrace(page)).length).toBeLessThanOrEqual(2);
    await expectAnchorAligned(page, "sobre");
  });

  test("from /cardapio arrive at the section without animation", async ({ page }) => {
    await openPage(page, "/cardapio", ".filter-tabs");
    // The trace loop survives the client-side navigation and starts sampling the new scroller.
    await startScrollTrace(page);
    await takeScrollTrace(page);
    await footerLink(page, "Onde estamos").click();
    await expect(page.locator(".homepage-content")).toBeVisible();
    await waitForScrollSettled(page, 600);
    expect((await takeScrollTrace(page)).length).toBeLessThanOrEqual(2);
    await expectAnchorAligned(page, "onde-estamos");
  });
});
