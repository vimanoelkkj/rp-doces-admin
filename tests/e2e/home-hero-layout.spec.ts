import { expect, test } from "@playwright/test";

// 600 and 768 are the stacked layout; 769 and 1025 are the first widths of the tablet and desktop
// two-column layouts, where the fixed-size visual column used to starve the text (the visual audit
// measured a 220px text column at 820px); the rest sample the middle and the end of each range.
const widths = [600, 768, 769, 820, 900, 1024, 1025, 1100, 1200, 1280, 1440];

// Floor for the paragraph width, in ems of its own font (18px → 360px). The copy averages about
// 0.54em per character, so this is ≈37 characters per line, near the ~40-character floor
// typographers allow for narrow columns; the 220px column of the audit held only ≈20.
const MIN_PARAGRAPH_EM = 20;
// Sub-pixel layout tolerance.
const EPSILON = 0.5;

for (const width of widths) {
  for (const theme of ["light", "dark"] as const) {
    test(`Hero text column is readable and nothing overlaps at ${width}px in ${theme} mode`, async ({
      page
    }) => {
      await page.setViewportSize({ width, height: 900 });
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
      // Line breaks depend on the web fonts, so measure only after they are in.
      await page.evaluate(async () => {
        await Promise.all([
          document.fonts.load('600 44px "Fraunces"'),
          document.fonts.load('400 18px "Manrope"')
        ]);
        await document.fonts.ready;
      });

      const layout = await page.evaluate(epsilon => {
        type Box = { left: number; top: number; right: number; bottom: number };
        const toBox = ({ left, top, right, bottom }: Box): Box => ({ left, top, right, bottom });
        const query = (selector: string) => {
          const element = document.querySelector<HTMLElement>(selector);
          if (!element) throw new Error(`Missing ${selector}`);
          return element;
        };
        const boxOf = (selector: string) => toBox(query(selector).getBoundingClientRect());
        // Line boxes of the rendered text: they expose words that spill out of their column.
        const lineBoxes = (selector: string) => {
          const range = document.createRange();
          range.selectNodeContents(query(selector));
          return [...range.getClientRects()].filter(rect => rect.width > 0).map(toBox);
        };
        const intersects = (a: Box, b: Box) =>
          Math.min(a.right, b.right) - Math.max(a.left, b.left) > epsilon &&
          Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > epsilon;

        const column = boxOf(".hero-left");
        const stack = [
          ".hero-eyebrow",
          ".hero-title",
          ".hero-description",
          ".hero-actions",
          ".trust-cards-wrapper"
        ];
        const ink = [
          ...[".hero-tag", ".hero-location", ".hero-cta", ".trust-card"].flatMap(selector =>
            [...document.querySelectorAll(selector)].map(element => ({
              name: selector,
              box: toBox(element.getBoundingClientRect())
            }))
          ),
          ...[".hero-title", ".hero-description"].flatMap(selector =>
            lineBoxes(selector).map(box => ({ name: `${selector} line`, box }))
          )
        ];
        const visuals = [".hero-right", ".hero-ellipse", ".hero-cake-image", ".floating-badge"]
          .filter(selector => getComputedStyle(query(selector)).display !== "none")
          .map(selector => ({ name: selector, box: boxOf(selector) }));

        const hero = query(".hero");
        const heroStyle = getComputedStyle(hero);
        const contentRight =
          hero.getBoundingClientRect().right - parseFloat(heroStyle.paddingRight);
        const visual = visuals.find(item => item.name === ".hero-right")?.box;
        const scroller = query(".homepage-content");
        const description = query(".hero-description");
        const stackBoxes = stack.map(selector => ({ name: selector, box: boxOf(selector) }));

        return {
          paragraphWidth: description.getBoundingClientRect().width,
          paragraphFontSize: parseFloat(getComputedStyle(description).fontSize),
          // Text and controls must stay inside the text column.
          spills: ink.filter(item => item.box.right > column.right + epsilon).map(i => i.name),
          overlaps: [
            ...ink.flatMap(item =>
              visuals
                .filter(other => intersects(item.box, other.box))
                .map(o => `${item.name} × ${o.name}`)
            ),
            ...stackBoxes.flatMap((item, index) =>
              index > 0 && item.box.top < stackBoxes[index - 1].box.bottom - epsilon
                ? [`${stackBoxes[index - 1].name} × ${item.name}`]
                : []
            )
          ],
          // The image and its ellipse must scale with their column instead of spilling out of it.
          escapes: [
            ...visuals
              .filter(item => [".hero-ellipse", ".hero-cake-image"].includes(item.name))
              .filter(
                item =>
                  !visual ||
                  item.box.left < visual.left - epsilon ||
                  item.box.right > visual.right + epsilon ||
                  item.box.top < visual.top - epsilon ||
                  item.box.bottom > visual.bottom + epsilon
              )
              .map(item => item.name),
            ...(visual && visual.right > contentRight + epsilon ? [".hero-right"] : [])
          ],
          overflowX: Math.max(
            document.documentElement.scrollWidth - innerWidth,
            scroller.scrollWidth - scroller.clientWidth
          )
        };
      }, EPSILON);

      expect(
        layout.paragraphWidth,
        `paragraph width in px (≥ ${MIN_PARAGRAPH_EM}em of ${layout.paragraphFontSize}px)`
      ).toBeGreaterThanOrEqual(MIN_PARAGRAPH_EM * layout.paragraphFontSize);
      expect(layout.spills, "text or controls wider than the text column").toEqual([]);
      expect(layout.overlaps, "overlapping Hero elements").toEqual([]);
      expect(layout.escapes, "visual elements outside their column").toEqual([]);
      expect(layout.overflowX, "horizontal overflow").toBeLessThanOrEqual(0);
    });
  }
}
