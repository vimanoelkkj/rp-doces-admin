import { expect, type Page } from "@playwright/test";

export interface ScrollCall {
  kind: string;
  target: string;
  top: number | null;
  behavior: string | null;
}

type TracedWindow = typeof window & {
  scrollCalls: ScrollCall[];
  clickDefaultsPrevented: boolean[];
  scrollTrace: number[];
  scrollTraceRunning?: boolean;
};

// Keeps the browser regressions local: only /api/produtos has a body, everything else is {}.
// The route lives on the context so tabs opened with Ctrl/Cmd+click are covered too.
export async function mockStorefrontApi(page: Page) {
  await page.context().route(
    url => url.pathname.startsWith("/api/"),
    route =>
      route.fulfill({
        json: new URL(route.request().url()).pathname === "/api/produtos" ? { produtos: [] } : {}
      })
  );
}

// Records every programmatic scroll the app requests, so tests can prove "one scroll per navigation".
export async function recordScrollCalls(page: Page) {
  await page.addInitScript(() => {
    const traced = window as TracedWindow;
    traced.scrollCalls = [];
    const describe = (element: Element) =>
      element.classList.contains("homepage-content")
        ? "scroller"
        : element.id || element.tagName.toLowerCase();
    for (const kind of ["scrollTo", "scroll", "scrollBy", "scrollIntoView"] as const) {
      const original = Element.prototype[kind] as (...args: unknown[]) => void;
      Element.prototype[kind] = function (this: Element, ...args: unknown[]) {
        const options =
          typeof args[0] === "object" && args[0] !== null ? (args[0] as ScrollToOptions) : null;
        traced.scrollCalls.push({
          kind,
          target: describe(this),
          top: options?.top ?? null,
          behavior: options?.behavior ?? null
        });
        return original.apply(this, args);
      } as never;
    }
  });
}

export async function takeNavigationScrolls(page: Page): Promise<ScrollCall[]> {
  return page.evaluate(() => {
    const traced = window as TracedWindow;
    const taken = traced.scrollCalls;
    traced.scrollCalls = [];
    return taken.filter(call => call.target === "scroller" || call.kind === "scrollIntoView");
  });
}

// Records, for every click, whether the page's own handlers cancelled it, and then cancels it so
// that no tab opens. A modified click belongs to the browser, and real tabs are unreliable in
// headless CI: the contract the app owns is that it does not cancel the click.
export async function trackClickDefaults(page: Page) {
  await page.evaluate(() => {
    const traced = window as TracedWindow;
    traced.clickDefaultsPrevented = [];
    // The Router's handlers run on the root container, before the event reaches the window.
    window.addEventListener("click", event => {
      traced.clickDefaultsPrevented.push(event.defaultPrevented);
      event.preventDefault();
    });
  });
}

export async function takeClickDefaults(page: Page): Promise<boolean[]> {
  return page.evaluate(() => {
    const traced = window as TracedWindow;
    const taken = traced.clickDefaultsPrevented;
    traced.clickDefaultsPrevented = [];
    return taken;
  });
}

// Samples the Home scroller on every frame; only changes are kept.
export async function startScrollTrace(page: Page) {
  await page.evaluate(() => {
    const traced = window as TracedWindow;
    const current = () => document.querySelector<HTMLElement>(".homepage-content")?.scrollTop ?? 0;
    traced.scrollTrace = [current()];
    if (traced.scrollTraceRunning) return;
    traced.scrollTraceRunning = true;
    const sample = () => {
      const top = current();
      if (top !== traced.scrollTrace[traced.scrollTrace.length - 1]) traced.scrollTrace.push(top);
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
}

export async function takeScrollTrace(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const traced = window as TracedWindow;
    const trace = traced.scrollTrace.slice();
    traced.scrollTrace = trace.slice(-1);
    return trace;
  });
}

export async function readScrollTop(page: Page): Promise<number> {
  return page.evaluate(
    () => document.querySelector<HTMLElement>(".homepage-content")?.scrollTop ?? 0
  );
}

// Waits until the Home scroller has been still for `quietMs`.
export async function waitForScrollSettled(page: Page, quietMs = 400) {
  await page.evaluate(async quiet => {
    const scroller = document.querySelector<HTMLElement>(".homepage-content");
    if (!scroller) throw new Error("Home scroller must be present");
    let last = scroller.scrollTop;
    let since = performance.now();
    await new Promise<void>(resolve => {
      const check = () => {
        const top = scroller.scrollTop;
        if (top !== last) {
          last = top;
          since = performance.now();
        }
        if (performance.now() - since >= quiet) resolve();
        else requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    });
  }, quietMs);
}

export async function readAnchor(page: Page, id: string) {
  return page.evaluate(targetId => {
    const scroller = document.querySelector<HTMLElement>(".homepage-content");
    const target = document.getElementById(targetId);
    if (!scroller || !target) throw new Error(`Home scroller and #${targetId} must be present`);
    const transform = getComputedStyle(target).transform;
    return {
      top: target.getBoundingClientRect().top,
      padding: Number.parseFloat(getComputedStyle(scroller).scrollPaddingTop),
      scrollTop: scroller.scrollTop,
      max: scroller.scrollHeight - scroller.clientHeight,
      // The reveal transition (translateY) has finished: geometry is final.
      settled: transform === "none" || transform === "matrix(1, 0, 0, 1, 0, 0)"
    };
  }, id);
}

// The section must rest on the scroll-padding edge (below Header, wave and fade) once the reveal
// transform is gone, or at the very end of the scroller when it cannot go any higher.
export async function expectAnchorAligned(page: Page, id: string) {
  await expect
    .poll(
      async () => {
        const anchor = await readAnchor(page, id);
        const atEnd = anchor.scrollTop >= anchor.max - 1;
        const aligned = anchor.settled && (atEnd || Math.abs(anchor.top - anchor.padding) <= 1);
        // A string keeps the measurements in the failure message.
        return aligned ? "aligned" : JSON.stringify(anchor);
      },
      { message: `#${id} must rest on the scroll-padding edge`, timeout: 8000 }
    )
    .toBe("aligned");
}

export function readHistory(page: Page) {
  return page.evaluate(() => ({
    length: history.length,
    state: history.state as { usr?: unknown; key?: string; idx?: number } | null,
    url: location.pathname + location.hash
  }));
}
