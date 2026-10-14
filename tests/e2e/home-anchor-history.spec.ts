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

const INITIAL_STATE = {
  usr: { source: "anchor-history-test", nested: { preserved: true } },
  key: "home-test",
  idx: 0
};

const headerLink = (page: Page, label: string) => page.locator(".main-nav a", { hasText: label });

async function openHome(page: Page) {
  await mockStorefrontApi(page);
  await recordScrollCalls(page);
  await page.addInitScript(state => history.replaceState(state, ""), INITIAL_STATE);
  await page.goto("/");
  await page.locator(".hero").waitFor();
  await page.evaluate(() => document.fonts.ready);
}

test.describe("Header anchors on Home (desktop)", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("repeated clicks add one entry and keep the Router metadata", async ({ page }) => {
    await openHome(page);
    const initial = await readHistory(page);

    await headerLink(page, "Sobre").click();
    await expect(page).toHaveURL(/\/#sobre$/);
    await waitForScrollSettled(page);
    const first = await readHistory(page);
    expect(first.length).toBe(initial.length + 1);
    expect(first.state?.usr).toEqual(INITIAL_STATE.usr);
    expect(first.state?.idx).toBe(1);
    expect(first.state?.key).toEqual(expect.any(String));
    expect(first.state?.key).not.toBe(INITIAL_STATE.key);

    for (let click = 0; click < 3; click++) {
      await headerLink(page, "Sobre").click();
      await waitForScrollSettled(page);
      const repeated = await readHistory(page);
      expect(repeated.length).toBe(first.length);
      expect(repeated.url).toBe("/#sobre");
      expect(repeated.state?.usr).toEqual(INITIAL_STATE.usr);
      expect(repeated.state?.idx).toBe(1);
      expect(repeated.state?.key).toEqual(expect.any(String));
    }
  });

  test("clicking the current section again brings the page back to it", async ({ page }) => {
    await openHome(page);
    await headerLink(page, "Sobre").click();
    await expectAnchorAligned(page, "sobre");
    const length = (await readHistory(page)).length;

    await page.locator(".homepage-content").evaluate(el => el.scrollTo({ top: 0 }));
    await expect.poll(() => readScrollTop(page)).toBe(0);
    await headerLink(page, "Sobre").click();
    await expectAnchorAligned(page, "sobre");
    expect((await readHistory(page)).length).toBe(length);
  });

  test("Back and Forward walk between different anchors and the top", async ({ page }) => {
    await openHome(page);
    await headerLink(page, "Sobre").click();
    await expectAnchorAligned(page, "sobre");
    await headerLink(page, "Contato").click();
    await expectAnchorAligned(page, "contato");
    const length = (await readHistory(page)).length;

    await page.goBack();
    await expect(page).toHaveURL(/\/#sobre$/);
    await expectAnchorAligned(page, "sobre");

    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await expect.poll(() => readScrollTop(page)).toBe(0);
    expect((await readHistory(page)).state?.usr).toEqual(INITIAL_STATE.usr);

    await page.goForward();
    await expect(page).toHaveURL(/\/#sobre$/);
    await expectAnchorAligned(page, "sobre");

    await page.goForward();
    await expect(page).toHaveURL(/\/#contato$/);
    await expectAnchorAligned(page, "contato");
    expect((await readHistory(page)).length).toBe(length);
  });

  test("every navigation asks for exactly one scroll", async ({ page }) => {
    await openHome(page);
    await takeNavigationScrolls(page);
    const scrollsAfter = async (action: () => Promise<unknown>) => {
      await action();
      await waitForScrollSettled(page);
      return takeNavigationScrolls(page);
    };

    expect(await scrollsAfter(() => headerLink(page, "Sobre").click())).toHaveLength(1);
    expect(await scrollsAfter(() => headerLink(page, "Sobre").click())).toHaveLength(1);
    expect(await scrollsAfter(() => headerLink(page, "Contato").click())).toHaveLength(1);
    expect(await scrollsAfter(() => page.goBack())).toHaveLength(1);
    expect(await scrollsAfter(() => page.goBack())).toHaveLength(1);
    expect(await scrollsAfter(() => page.goForward())).toHaveLength(1);
  });

  test("the Learn more entry keeps its own scroll when it is visited again", async ({ page }) => {
    await openHome(page);
    await page.locator(".hero-cta").click();
    await expect(page).toHaveURL(/\/#sobre$/);
    await waitForScrollSettled(page);
    const ctaTop = await readScrollTop(page);
    expect((await readHistory(page)).state).toMatchObject({ homeStoryCta: true });

    await headerLink(page, "Contato").click();
    await expectAnchorAligned(page, "contato");
    await takeNavigationScrolls(page);

    await page.goBack();
    await expect(page).toHaveURL(/\/#sobre$/);
    await waitForScrollSettled(page);
    const scrolls = await takeNavigationScrolls(page);
    expect(scrolls).toHaveLength(1);
    expect(scrolls[0].kind).toBe("scrollTo");
    expect(Math.abs((await readScrollTop(page)) - ctaTop)).toBeLessThanOrEqual(1);
  });

  test("Back to the top is instant, so a quick Forward cannot cut it short", async ({ page }) => {
    await openHome(page);
    await headerLink(page, "Sobre").click();
    await expectAnchorAligned(page, "sobre");
    await takeNavigationScrolls(page);

    // A smooth scroll to the top that the next entry interrupts can end a few px off in Chrome.
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await expect.poll(() => readScrollTop(page)).toBe(0);
    expect(await takeNavigationScrolls(page)).toEqual([
      { kind: "scrollTo", target: "scroller", top: 0, behavior: "instant" }
    ]);
  });

  test("Ctrl/Cmd+click is left to the browser and leaves this page untouched", async ({ page }) => {
    await openHome(page);
    const before = await readHistory(page);
    await trackClickDefaults(page);

    await headerLink(page, "Sobre").click({ modifiers: ["ControlOrMeta"] });
    expect(await takeClickDefaults(page)).toEqual([false]);
    expect(await readHistory(page)).toEqual(before);
    expect(await readScrollTop(page)).toBe(0);
    // What the browser opens in the new tab: the section of the Home.
    const target = await headerLink(page, "Sobre").evaluate(link => {
      const url = new URL((link as HTMLAnchorElement).href);
      return url.pathname + url.hash;
    });
    expect(target).toBe("/#sobre");

    // Control: the Router handles a plain click, so the probe does see it cancelled.
    await headerLink(page, "Sobre").click();
    expect(await takeClickDefaults(page)).toEqual([true]);
  });

  test("smooth scroll by default", async ({ page }) => {
    await openHome(page);
    await startScrollTrace(page);
    await takeScrollTrace(page);
    await headerLink(page, "Sobre").click();
    await waitForScrollSettled(page);
    const trace = await takeScrollTrace(page);
    expect(trace.length).toBeGreaterThan(4);
    const jumps = trace.slice(1).map((top, index) => Math.abs(top - trace[index]));
    expect(Math.max(...jumps)).toBeLessThan(trace[trace.length - 1] / 2);
  });
});

test.describe("Header anchors with reduced motion", () => {
  test.use({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });

  test("jumps straight to the section, also on Back and Forward", async ({ page }) => {
    await openHome(page);
    await startScrollTrace(page);

    const jumpsOf = async (action: () => Promise<unknown>) => {
      await takeScrollTrace(page);
      await action();
      await waitForScrollSettled(page);
      return takeScrollTrace(page);
    };

    expect((await jumpsOf(() => headerLink(page, "Sobre").click())).length).toBeLessThanOrEqual(2);
    expect((await jumpsOf(() => headerLink(page, "Contato").click())).length).toBeLessThanOrEqual(
      2
    );
    expect((await jumpsOf(() => page.goBack())).length).toBeLessThanOrEqual(2);
    expect((await jumpsOf(() => page.goBack())).length).toBeLessThanOrEqual(2);
    expect(await readScrollTop(page)).toBe(0);
  });
});

test.describe("Header anchors from another page (desktop)", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("arrive aligned with one scroll, and Back/Forward round-trip", async ({ page }) => {
    await mockStorefrontApi(page);
    await recordScrollCalls(page);
    await page.goto("/cardapio");
    await page.locator(".filter-tabs").waitFor();
    const initial = await readHistory(page);

    await headerLink(page, "Sobre").click();
    await expect(page).toHaveURL(/\/#sobre$/);
    await expect(page.locator(".homepage-content")).toBeVisible();
    await waitForScrollSettled(page, 600);
    await expectAnchorAligned(page, "sobre");
    expect(await takeNavigationScrolls(page)).toHaveLength(1);
    expect((await readHistory(page)).length).toBe(initial.length + 1);

    await page.goBack();
    await expect(page).toHaveURL(/\/cardapio$/);
    await page.goForward();
    await expect(page).toHaveURL(/\/#sobre$/);
    await expect(page.locator(".homepage-content")).toBeVisible();
    await waitForScrollSettled(page, 600);
    await expectAnchorAligned(page, "sobre");
  });

  test("the Cardápio link keeps leading to the Home section", async ({ page }) => {
    await mockStorefrontApi(page);
    await page.goto("/cardapio");
    await page.locator(".filter-tabs").waitFor();

    await headerLink(page, "Cardápio").click();
    await expect(page).toHaveURL(/\/#cardapio$/);
    await expect(page.locator(".homepage-content")).toBeVisible();
    await waitForScrollSettled(page, 600);
    await expectAnchorAligned(page, "cardapio");
  });
});

test.describe("Mobile drawer anchors", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("use Router history like the Header links", async ({ page }) => {
    await openHome(page);
    const initial = await readHistory(page);
    const openDrawerAndTap = async (label: string) => {
      await page.getByRole("button", { name: "Abrir menu", exact: true }).tap();
      await page.locator(".mobile-menu-link", { hasText: label }).tap();
      await expect(page.locator(".mobile-menu-btn")).toHaveAttribute("aria-expanded", "false");
      await waitForScrollSettled(page);
    };

    await openDrawerAndTap("Sobre");
    await expect(page).toHaveURL(/\/#sobre$/);
    await expectAnchorAligned(page, "sobre");
    const first = await readHistory(page);
    expect(first.length).toBe(initial.length + 1);
    expect(first.state?.usr).toEqual(INITIAL_STATE.usr);
    expect(first.state?.idx).toBe(1);

    await openDrawerAndTap("Sobre");
    const repeated = await readHistory(page);
    expect(repeated.length).toBe(first.length);
    expect(repeated.state?.idx).toBe(1);

    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await expect.poll(() => readScrollTop(page)).toBe(0);
  });

  test("from /cardapio they arrive at the Home section with one scroll", async ({ page }) => {
    await mockStorefrontApi(page);
    await recordScrollCalls(page);
    await page.goto("/cardapio");
    await page.locator(".filter-tabs").waitFor();

    await page.getByRole("button", { name: "Abrir menu", exact: true }).tap();
    await page.locator(".mobile-menu-link", { hasText: "Onde estamos" }).tap();
    await expect(page).toHaveURL(/\/#onde-estamos$/);
    await expect(page.locator(".homepage-content")).toBeVisible();
    await waitForScrollSettled(page, 600);
    await expectAnchorAligned(page, "onde-estamos");
    expect(await takeNavigationScrolls(page)).toHaveLength(1);
  });
});
