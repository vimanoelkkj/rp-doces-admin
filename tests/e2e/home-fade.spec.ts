import { expect, test } from "@playwright/test";

for (const theme of ["light", "dark"] as const) {
  test(`Home fade stays unmasked and interactive in ${theme} mode`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(value => localStorage.setItem("store-theme", value), theme);
    await page.route(
      url => url.pathname.startsWith("/api/"),
      route =>
        route.fulfill({
          json: new URL(route.request().url()).pathname === "/api/produtos" ? { produtos: [] } : {}
        })
    );
    await page.goto("/");
    await page.locator(".homepage-content").waitFor();
    const layers = await page.evaluate(() => {
      const main = document.querySelector(".homepage-content");
      const home = document.querySelector(".homepage");
      const wave = document.querySelector(".wave-container");
      if (!main || !home || !wave) throw new Error("Home layers must be present");
      const fade = getComputedStyle(home, "::after");
      return {
        mask: getComputedStyle(main).maskImage,
        webkitMask: getComputedStyle(main).getPropertyValue("-webkit-mask-image"),
        fadeMask: fade.maskImage,
        pointerEvents: fade.pointerEvents,
        position: fade.position,
        height: Number.parseFloat(fade.height),
        waveHeight: wave.getBoundingClientRect().height
      };
    });
    expect(layers.mask).toBe("none");
    expect(layers.webkitMask).toBe("none");
    expect(layers.fadeMask).toBe("none");
    expect(layers.pointerEvents).toBe("none");
    expect(layers.position).toBe("fixed");
    expect(layers.height).toBeCloseTo(layers.waveHeight + 94);
    await page.mouse.move(200, layers.waveHeight + 30);
    await page.mouse.wheel(0, 500);
    await expect
      .poll(() => page.locator(".homepage-content").evaluate(el => el.scrollTop))
      .toBeGreaterThan(0);
    await page.getByRole("button", { name: "Voltar ao topo", exact: true }).click();
    await expect.poll(() => page.locator(".homepage-content").evaluate(el => el.scrollTop)).toBe(0);
  });
}
