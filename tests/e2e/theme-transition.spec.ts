import { test, expect, type Page, type TestInfo } from "@playwright/test";

/**
 * Valida a transição de tema (View Transitions API + radial reveal) no desktop.
 *
 * Requer o app rodando (padrão http://localhost:5173, sobrescreva com BASE_URL)
 * e com ao menos um produto listado em /cardapio.
 *
 * Usa o Chrome real instalado. Sobrescreva o caminho com CHROME_PATH se necessário.
 */

const CHROME_PATH =
  process.env.CHROME_PATH ??
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE_URL = process.env.BASE_URL ?? "http://localhost:5173";
const PAGE_PATH = process.env.THEME_TEST_PATH ?? "/";

const TOLERANCE_PX = 0.5;
const SCREENSHOT_POINTS = 5;

test.use({
  baseURL: BASE_URL,
  viewport: { width: 1440, height: 900 },
  reducedMotion: "no-preference",
  launchOptions: { executablePath: CHROME_PATH },
});

type Rect = { x: number; y: number; width: number; height: number };
type Rects = Record<"header" | "logo" | "themeButton" | "firstCard", Rect>;

const SELECTORS: Record<keyof Rects, string> = {
  header: ".header",
  logo: ".header .logo",
  themeButton: ".theme-toggle-btn",
  firstCard: ".hero",
};

type ScrollerMetrics = {
  rectWidth: number;
  clientWidth: number;
  offsetWidth: number;
  scrollWidth: number;
} | null;

const SCROLLER_SELECTOR = ".homepage-content";

type Frame = {
  t: number;
  rects: Rects;
  scroller: ScrollerMetrics;
  progress: number | null;
  clip: string | null;
  rootTransform: string;
  bodyTransform: string;
  visualScale: number;
};

type AnimInfo = {
  pseudo: string | null;
  properties: string[];
  clipStart: string | null;
  clipEnd: string | null;
};

async function readRects(page: Page): Promise<Rects> {
  return page.evaluate((selectors) => {
    const out = {} as Record<string, Rect>;
    for (const [key, sel] of Object.entries(selectors)) {
      const el = document.querySelector(sel);
      if (!el) throw new Error(`Elemento não encontrado: ${sel}`);
      const r = el.getBoundingClientRect();
      out[key] = { x: r.x, y: r.y, width: r.width, height: r.height };
    }
    return out;
  }, SELECTORS) as Promise<Rects>;
}

function expectSameRects(actual: Rects, baseline: Rects, label: string) {
  for (const key of Object.keys(baseline) as (keyof Rects)[]) {
    for (const prop of ["x", "y", "width", "height"] as const) {
      const diff = Math.abs(actual[key][prop] - baseline[key][prop]);
      expect(
        diff,
        `${label}: ${key}.${prop} mudou (${baseline[key][prop]} -> ${actual[key][prop]})`,
      ).toBeLessThanOrEqual(TOLERANCE_PX);
    }
  }
}

async function readScroller(page: Page): Promise<ScrollerMetrics> {
  return page.evaluate((sel) => {
    const el = document.querySelector<HTMLElement>(sel);
    if (!el) return null;
    return {
      rectWidth: el.getBoundingClientRect().width,
      clientWidth: el.clientWidth,
      offsetWidth: el.offsetWidth,
      scrollWidth: el.scrollWidth,
    };
  }, SCROLLER_SELECTOR);
}

/** Instala um amostrador por frame (rAF) que roda dentro da página. */
async function installSampler(page: Page) {
  await page.evaluate(({ selectors, scrollerSel }) => {
    const w = window as any;
    w.__frames = [] as Frame[];
    w.__anims = [] as AnimInfo[];
    w.__samplerRunning = true;
    const start = performance.now();

    const tick = () => {
      if (!w.__samplerRunning) return;
      const rects: Record<string, unknown> = {};
      for (const [key, sel] of Object.entries(selectors as Record<string, string>)) {
        const el = document.querySelector(sel);
        if (el) {
          const r = el.getBoundingClientRect();
          rects[key] = { x: r.x, y: r.y, width: r.width, height: r.height };
        }
      }

      let progress: number | null = null;
      let clip: string | null = null;
      for (const a of document.getAnimations()) {
        const eff = a.effect as KeyframeEffect | null;
        const pseudo = eff?.pseudoElement ?? null;
        if (pseudo && pseudo.includes("view-transition")) {
          const known = w.__anims.some(
            (i: AnimInfo) => i.pseudo === pseudo,
          );
          const kfs = eff!.getKeyframes() as Keyframe[];
          if (!known) {
            const props = new Set<string>();
            kfs.forEach((k) =>
              Object.keys(k).forEach((p) => {
                if (!["offset", "easing", "composite", "computedOffset"].includes(p))
                  props.add(p);
              }),
            );
            w.__anims.push({
              pseudo,
              properties: [...props],
              clipStart: (kfs[0] as any)?.clipPath ?? null,
              clipEnd: (kfs[kfs.length - 1] as any)?.clipPath ?? null,
            });
          }
          if (pseudo.includes("new") && (kfs[0] as any)?.clipPath) {
            progress = eff!.getComputedTiming().progress ?? null;
            clip = String((kfs[0] as any).clipPath);
          }
        }
      }

      const sc = document.querySelector<HTMLElement>(scrollerSel);
      w.__frames.push({
        t: performance.now() - start,
        rects,
        scroller: sc
          ? {
              rectWidth: sc.getBoundingClientRect().width,
              clientWidth: sc.clientWidth,
              offsetWidth: sc.offsetWidth,
              scrollWidth: sc.scrollWidth,
            }
          : null,
        progress,
        clip,
        rootTransform: getComputedStyle(document.documentElement).transform,
        bodyTransform: getComputedStyle(document.body).transform,
        visualScale: window.visualViewport?.scale ?? 1,
      });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, { selectors: SELECTORS, scrollerSel: SCROLLER_SELECTOR });
}

async function stopSampler(page: Page) {
  return page.evaluate(() => {
    const w = window as any;
    w.__samplerRunning = false;
    return { frames: w.__frames as Frame[], anims: w.__anims as AnimInfo[] };
  });
}

async function attachShot(
  page: Page,
  testInfo: TestInfo,
  name: string,
) {
  const body = await page.screenshot({ animations: "allow", caret: "initial" });
  await testInfo.attach(name, { body, contentType: "image/png" });
}

async function runTransition(
  page: Page,
  testInfo: TestInfo,
  from: "light" | "dark",
  to: "light" | "dark",
) {
  const label = `${from}-to-${to}`;
  const toggle = page.locator(SELECTORS.themeButton);

  await expect(page.locator("html")).toHaveAttribute("data-theme", from);

  // Afasta o mouse do botão: :hover aplica transform: scale(1.05), que altera
  // getBoundingClientRect() sem ser layout shift. Espera a transition de 150ms terminar.
  await page.mouse.move(0, 0);
  await page.waitForTimeout(300);
  const baseline = await readRects(page);
  const scrollerBefore = await readScroller(page);
  await attachShot(page, testInfo, `${label}-00-before`);

  await installSampler(page);
  // Clique programático (sem hover do mouse); ainda dispara o onClick real do React.
  await toggle.evaluate((element) => {
    (element as HTMLElement).click();
  });

  // Capturas em vários pontos durante os ~480ms da animação.
  for (let i = 1; i <= SCREENSHOT_POINTS; i++) {
    await attachShot(page, testInfo, `${label}-0${i}-during`);
  }

  await expect(page.locator("html")).toHaveAttribute("data-theme", to);
  await expect(page.locator("html")).not.toHaveAttribute(
    "data-theme-transitioning",
    "true",
    { timeout: 5000 },
  );
  await page.waitForTimeout(200);

  const { frames, anims } = await stopSampler(page);
  const after = await readRects(page);
  await attachShot(page, testInfo, `${label}-99-after`);

  // --- Diagnóstico do scroller real (.homepage-content) ---
  const scrollerAfter = await readScroller(page);
  const scrollerDuring = frames.map((f) => f.scroller);
  const distinctDuring = [
    ...new Set(scrollerDuring.map((m) => JSON.stringify(m))),
  ].map((m) => JSON.parse(m));
  await testInfo.attach(`${label}-scroller-metrics.json`, {
    body: JSON.stringify(
      { before: scrollerBefore, during: distinctDuring, after: scrollerAfter },
      null,
      2,
    ),
    contentType: "application/json",
  });
  console.log(
    `[${label}] ${SCROLLER_SELECTOR} before=${JSON.stringify(scrollerBefore)} during(distinct)=${JSON.stringify(distinctDuring)} after=${JSON.stringify(scrollerAfter)}`,
  );

  // --- Layout: nada se desloca, em nenhum frame nem no final ---
  expect(frames.length, `${label}: poucos frames amostrados`).toBeGreaterThan(10);
  for (const f of frames) {
    expectSameRects(f.rects, baseline, `${label} @${f.t.toFixed(0)}ms`);
  }
  expectSameRects(after, baseline, `${label} final`);

  // --- Sem scale/zoom ---
  for (const f of frames) {
    expect(f.rootTransform, `${label}: transform em <html>`).toBe("none");
    expect(f.bodyTransform, `${label}: transform em <body>`).toBe("none");
    expect(f.visualScale, `${label}: zoom do viewport`).toBe(1);
  }

  // --- Radial reveal presente: clip-path circle() em ::view-transition-new(root) ---
  const reveal = anims.find(
    (a) => a.pseudo?.includes("view-transition-new") && a.clipStart,
  );
  expect(reveal, `${label}: animação clip-path do reveal não encontrada`).toBeTruthy();
  expect(reveal!.clipStart).toMatch(/^circle\(0px at /);
  expect(reveal!.clipEnd).toMatch(/^circle\([\d.]+px at /);
  const endRadius = parseFloat(reveal!.clipEnd!.match(/circle\(([\d.]+)px/)![1]);
  const cornerDist = Math.hypot(1440, 900);
  expect(endRadius, `${label}: raio final não cobre a tela`).toBeGreaterThan(900);
  expect(endRadius).toBeLessThanOrEqual(cornerDist + 1);

  // Progresso avança de forma monotônica e passa por valores intermediários.
  const progresses = frames
    .map((f) => f.progress)
    .filter((p): p is number => p !== null);
  expect(progresses.length, `${label}: reveal sem frames`).toBeGreaterThan(3);
  for (let i = 1; i < progresses.length; i++) {
    expect(progresses[i]).toBeGreaterThanOrEqual(progresses[i - 1] - 1e-6);
  }
  expect(progresses.some((p) => p > 0.05 && p < 0.95)).toBe(true);

  // --- Sem scale/zoom/ghosting/fade: só clip-path anima; old/new sem transform/opacity ---
  for (const a of anims) {
    expect(
      a.properties.filter((p) => /transform|scale|translate|rotate|opacity|filter/i.test(p)),
      `${label}: ${a.pseudo} anima propriedade indevida (${a.properties.join(",")})`,
    ).toEqual([]);
  }
  // Somente a camada "new" pode ter animação (o reveal). "old" deve ficar estática.
  expect(
    anims.filter((a) => a.pseudo?.includes("view-transition-old")),
    `${label}: ::view-transition-old(root) animando (ghosting)`,
  ).toEqual([]);
}

test.setTimeout(90000);

test.describe("transição de tema (desktop)", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem("store-theme", "light");
      } catch {
        /* ignore */
      }
    });
    await page.goto(PAGE_PATH);
    await page.locator(SELECTORS.firstCard).first().waitFor({ state: "visible", timeout: 20000 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(800); // assenta animações de entrada
  });

  test("light -> dark e dark -> light sem deslocar elementos, com radial reveal", async ({
    page,
  }, testInfo) => {
    const supported = await page.evaluate(
      () => typeof (document as any).startViewTransition === "function",
    );
    expect(supported, "Chrome sem View Transitions API").toBe(true);

    await runTransition(page, testInfo, "light", "dark");
    await runTransition(page, testInfo, "dark", "light");
  });
});
