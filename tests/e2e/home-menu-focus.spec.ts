import { expect, test, type Page } from "@playwright/test";

async function openMenu(page: Page) {
  await page.getByRole("button", { name: "Abrir menu", exact: true }).click();
  await expect(page.locator(".mobile-menu-link").first()).toBeFocused();
  await expect(page.locator("#mobile-menu-drawer")).not.toHaveAttribute("inert");
  await expect
    .poll(() =>
      page.locator("#mobile-menu-drawer").evaluate(el => el.getBoundingClientRect().bottom)
    )
    .toBeLessThanOrEqual(844.5);
}

async function expectClosed(page: Page) {
  await expect(page.locator(".mobile-menu-btn")).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#mobile-menu-drawer")).toHaveAttribute("inert", "");
  await expect(page.locator(".mobile-menu-btn")).toBeFocused();
}

for (const theme of ["light", "dark"] as const) {
  test.describe(`Home menu focus in ${theme} mode`, () => {
    test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

    test.beforeEach(async ({ page }) => {
      await page.addInitScript(value => localStorage.setItem("store-theme", value), theme);
      await page.route(
        url => url.pathname.startsWith("/api/"),
        route =>
          route.fulfill({
            json:
              new URL(route.request().url()).pathname === "/api/produtos" ? { produtos: [] } : {}
          })
      );
      await page.goto("/");
      await page.locator(".hero").waitFor();
      await page.evaluate(() => document.fonts.ready);
    });

    test("closed drawer cannot receive keyboard focus or activate destinations", async ({
      page
    }) => {
      for (const width of [390, 1440]) {
        await page.setViewportSize({ width, height: 844 });
        await page.locator(".logo").focus();
        for (let index = 0; index < 24; index++) {
          await page.keyboard.press("Tab");
          expect(
            await page.evaluate(() => !!document.activeElement?.closest("#mobile-menu-drawer"))
          ).toBe(false);
        }
        for (const control of await page.locator("#mobile-menu-drawer button").all()) {
          await page.locator(".logo").focus();
          await control.evaluate(el => el.focus());
          await expect(page.locator(".logo")).toBeFocused();
          await page.keyboard.press("Enter");
          await expect(page).toHaveURL(/\/$/);
        }
      }
    });

    test("opening focuses a menu action and wraps Tab in both directions", async ({ page }) => {
      await page.locator(".mobile-menu-btn").focus();
      await page.keyboard.press("Enter");
      await expect(page.locator(".mobile-menu-link").first()).toBeFocused();
      for (const key of ["Tab", "Shift+Tab"]) {
        for (let index = 0; index < 12; index++) {
          await page.keyboard.press(key);
          expect(
            await page.evaluate(() => !!document.activeElement?.closest("#mobile-menu-drawer"))
          ).toBe(true);
        }
      }
      await page.locator(".mobile-menu-close").focus();
      await page.keyboard.press("Shift+Tab");
      await expect(page.locator(".mobile-menu-link").last()).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(page.locator(".mobile-menu-close")).toBeFocused();
    });

    test("Escape restores focus and reopening during close remains usable", async ({ page }) => {
      await openMenu(page);
      await page.keyboard.press("Escape");
      await expectClosed(page);
      await page.keyboard.press("Enter");
      await expect(page.locator(".mobile-menu-link").first()).toBeFocused();
      await page.keyboard.press("Escape");
      await expectClosed(page);
      await expect
        .poll(() =>
          page.locator("#mobile-menu-drawer").evaluate(el => el.getBoundingClientRect().top)
        )
        .toBeGreaterThanOrEqual(844);
    });

    test("outside click and close handle restore focus without changing scroll", async ({
      page
    }) => {
      await page.locator(".homepage-content").evaluate(el => el.scrollTo(0, 400));
      for (const close of ["outside", "handle"]) {
        await openMenu(page);
        if (close === "outside") await page.mouse.click(10, 200);
        else await page.locator(".mobile-menu-close").click();
        await expectClosed(page);
        expect(await page.locator(".homepage-content").evaluate(el => el.scrollTop)).toBe(400);
      }
    });

    test("touch drag closes and cancelled drag keeps the menu usable", async ({ page }) => {
      const session = await page.context().newCDPSession(page);
      try {
        for (const cancelled of [true, false]) {
          if (
            !((await page.locator(".mobile-menu-btn").getAttribute("aria-expanded")) === "true")
          ) {
            await openMenu(page);
          }
          const drawer = page.locator("#mobile-menu-drawer");
          // CDP touch coordinates need a settled target after a cancelled drag.
          await drawer.evaluate(async el => {
            await Promise.all(el.getAnimations().map(animation => animation.finished));
          });
          await expect(drawer).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
          const box = await page.locator(".mobile-menu-close").boundingBox();
          if (!box) throw new Error("Close handle must be visible");
          const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
          await session.send("Input.dispatchTouchEvent", {
            type: "touchStart",
            touchPoints: [point]
          });
          await expect(drawer).toHaveClass(/mobile-menu--dragging/);
          await session.send("Input.dispatchTouchEvent", {
            type: "touchMove",
            touchPoints: [{ ...point, y: point.y + 140 }]
          });
          await expect(drawer).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 140)");
          await session.send("Input.dispatchTouchEvent", {
            type: cancelled ? "touchCancel" : "touchEnd",
            touchPoints: []
          });
          if (cancelled) {
            await expect(drawer).not.toHaveClass(/mobile-menu--dragging/);
            await expect(page.locator(".mobile-menu-btn")).toHaveAttribute("aria-expanded", "true");
            await expect(page.locator("#mobile-menu-drawer")).not.toHaveAttribute("inert");
            await page.keyboard.press("Tab");
            expect(
              await page.evaluate(() => !!document.activeElement?.closest("#mobile-menu-drawer"))
            ).toBe(true);
          } else await expectClosed(page);
        }
      } finally {
        await session.detach();
      }
    });

    test("menu destination closes, restores focus and preserves anchor scroll", async ({
      page
    }) => {
      await openMenu(page);
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/#cardapio$/);
      await expectClosed(page);
      await expect
        .poll(() => page.locator(".homepage-content").evaluate(el => el.scrollTop))
        .toBeGreaterThan(0);
    });

    test("keyboard theme toggle retains visible focus and scroll", async ({ page }) => {
      await page.locator(".homepage-content").evaluate(el => el.scrollTo(0, 400));
      const button = page.locator(".theme-toggle-btn");
      await page.locator(".logo").focus();
      await page.keyboard.press("Tab");
      await expect(button).toBeFocused();
      for (const next of [theme === "light" ? "dark" : "light", theme]) {
        await page.keyboard.press("Enter");
        await expect(page.locator("html")).toHaveAttribute("data-theme", next);
        await expect(page.locator("html")).not.toHaveAttribute("data-theme-transitioning");
        await expect(button).toBeFocused();
        expect(await button.evaluate(el => el.matches(":focus-visible"))).toBe(true);
        expect(await button.evaluate(el => getComputedStyle(el).outlineStyle)).toBe("solid");
        expect(await page.locator(".homepage-content").evaluate(el => el.scrollTop)).toBe(400);
        expect(await page.evaluate(() => localStorage.getItem("store-theme"))).toBe(next);
      }
    });
  });
}
