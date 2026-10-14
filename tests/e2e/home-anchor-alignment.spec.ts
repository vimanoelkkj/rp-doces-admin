import { expect, test, type Page } from "@playwright/test";
import {
  expectAnchorAligned,
  mockStorefrontApi,
  readAnchor,
  readScrollTop,
  recordScrollCalls,
  takeNavigationScrolls,
  waitForScrollSettled
} from "./support/home-navigation";

// Sections whose own reveal transform (translateY(40px)) used to leave the destination 40px short.
const revealTargets = new Set(["sobre", "onde-estamos"]);
const sections = [
  { hash: "sobre", label: "Sobre" },
  { hash: "onde-estamos", label: "Onde estamos" },
  { hash: "cardapio", label: "Cardápio" },
  { hash: "contato", label: "Contato" }
];

async function openHome(page: Page, path = "/") {
  await mockStorefrontApi(page);
  await recordScrollCalls(page);
  await page.goto(path);
  await page.locator(".hero").waitFor();
  await page.evaluate(() => document.fonts.ready);
}

// The destination must not drift once the reveal transition finishes.
async function expectStable(page: Page, hash: string) {
  const settled = await readScrollTop(page);
  await page.waitForTimeout(1200);
  expect(Math.abs((await readScrollTop(page)) - settled)).toBeLessThanOrEqual(0.5);
  await expectAnchorAligned(page, hash);
}

test.describe("Anchor alignment (desktop)", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  for (const { hash, label } of sections) {
    test(`Header link to #${hash} rests on the scroll-padding edge`, async ({ page }) => {
      await openHome(page);
      if (revealTargets.has(hash)) {
        await expect(page.locator(`#${hash}`)).not.toHaveClass(/revealed/);
      }
      await takeNavigationScrolls(page);

      await page.locator(".main-nav a", { hasText: label }).click();
      await waitForScrollSettled(page);
      await expectAnchorAligned(page, hash);
      await expectStable(page, hash);
      expect(await takeNavigationScrolls(page)).toHaveLength(1);
    });

    test(`deep link /#${hash} rests on the scroll-padding edge`, async ({ page }) => {
      await openHome(page, `/#${hash}`);
      await waitForScrollSettled(page);
      await expectAnchorAligned(page, hash);
      await expectStable(page, hash);
      expect(await takeNavigationScrolls(page)).toHaveLength(1);
    });
  }

  test("the stable reference does not depend on the reveal having run", async ({ page }) => {
    // Revealed first (user scrolled through the page), then navigated: same destination.
    await openHome(page);
    await page.locator(".main-nav a", { hasText: "Sobre" }).click();
    await expectAnchorAligned(page, "sobre");
    const revealedTop = await readScrollTop(page);

    await page.locator(".homepage-content").evaluate(el => el.scrollTo({ top: 0 }));
    await expect.poll(() => readScrollTop(page)).toBe(0);
    await page.locator(".main-nav a", { hasText: "Sobre" }).click();
    await expectAnchorAligned(page, "sobre");
    expect(Math.abs((await readScrollTop(page)) - revealedTop)).toBeLessThanOrEqual(1);

    await page.goto("/");
    await page.locator(".hero").waitFor();
    await expect(page.locator("#sobre")).not.toHaveClass(/revealed/);
    await page.locator(".main-nav a", { hasText: "Sobre" }).click();
    await expectAnchorAligned(page, "sobre");
    expect(Math.abs((await readScrollTop(page)) - revealedTop)).toBeLessThanOrEqual(1);
  });
});

test.describe("Anchor alignment (mobile drawer)", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  // "Cardápio" is no longer in the drawer; it stays reachable by the deep link below.
  for (const { hash, label } of sections.filter(section => section.hash !== "cardapio")) {
    test(`drawer link to #${hash} rests on the scroll-padding edge`, async ({ page }) => {
      await openHome(page);
      if (revealTargets.has(hash)) {
        await expect(page.locator(`#${hash}`)).not.toHaveClass(/revealed/);
      }
      await takeNavigationScrolls(page);

      await page.getByRole("button", { name: "Abrir menu", exact: true }).tap();
      await page.locator(".mobile-menu-link", { hasText: label }).tap();
      await waitForScrollSettled(page);
      await expectAnchorAligned(page, hash);
      await expectStable(page, hash);
      expect(await takeNavigationScrolls(page)).toHaveLength(1);
    });
  }

  test("deep link /#cardapio rests on the scroll-padding edge", async ({ page }) => {
    await openHome(page, "/#cardapio");
    await waitForScrollSettled(page);
    await expectAnchorAligned(page, "cardapio");
    expect((await readAnchor(page, "cardapio")).padding).toBeGreaterThan(0);
  });
});
