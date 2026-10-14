import { useCallback, useEffect, useRef } from "react";
import type { RefObject } from "react";
import { createPath, useLocation, useNavigate } from "react-router-dom";

// Longest wait for the page load and for webfonts, so a stalled request cannot hold a scroll back.
const LAYOUT_WAIT_LIMIT_MS = 1500;

const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
const documentLoaded = () =>
  new Promise<void>(resolve => window.addEventListener("load", () => resolve(), { once: true }));
const within = (promise: Promise<unknown>, ms: number) =>
  Promise.race([promise, new Promise(resolve => setTimeout(resolve, ms))]);

// A deep link scrolls while the page is still loading: the webfont stylesheet ends the load, the
// fonts are requested on the layout after it, and they reflow the page when they arrive. So wait
// for the load, for a painted frame and then for the fonts in flight; the offsets measured
// afterwards do not move again.
async function layoutSettled() {
  if (document.readyState !== "complete") await within(documentLoaded(), LAYOUT_WAIT_LIMIT_MS);
  await nextFrame();
  await nextFrame();
  const fonts = document.fonts;
  if (fonts?.status === "loading") await within(fonts.ready, LAYOUT_WAIT_LIMIT_MS);
}

function scrollBehavior(): ScrollBehavior {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth";
}

function sectionFor(hash: string): HTMLElement | null {
  let id = hash.replace(/^#/, "");
  try {
    id = decodeURIComponent(id);
  } catch {
    // A malformed escape is looked up as typed, like a browser does.
  }
  return id ? document.getElementById(id) : null;
}

// Offset of the element inside the scroller, from layout boxes only. The reveal transform moves the
// painted box but never the layout box, so the destination does not depend on animation progress.
function layoutOffsetWithin(scroller: HTMLElement, element: HTMLElement): number | null {
  let offset = 0;
  let node: HTMLElement | null = element;
  while (node && node !== scroller) {
    offset += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  return node === scroller ? offset : null;
}

function scrollToSection(scroller: HTMLElement, hash: string) {
  const section = sectionFor(hash);
  if (!section) return;
  const offset = layoutOffsetWithin(scroller, section);
  if (offset === null) return;
  // The stylesheet reserves scroll-padding-top for the fixed Header, the wave and the fade.
  const clearance = Number.parseFloat(getComputedStyle(scroller).scrollPaddingTop) || 0;
  scroller.scrollTo({ top: offset - clearance, behavior: scrollBehavior() });
}

// The Home scrolls inside its own container, so the browser's anchor handling does not reach it.
// This is the only place that scrolls for a Home section: links just navigate, and every
// navigation (click, repeated click, Back, Forward, arrival from another page) lands here once.
export function useHomeHashScroll(scrollerRef: RefObject<HTMLElement | null>) {
  const { key, hash } = useLocation();
  const previousHash = useRef(hash);

  useEffect(() => {
    // `key` is new on every navigation, so repeating a link brings the page back to its section.
    const request = { key, hash };
    const hadHash = previousHash.current !== "";
    previousHash.current = hash;
    // The Learn more CTA owns the scroll of its own history entry (photo first).
    if (hash === "#sobre" && window.history.state?.homeStoryCta === true) return;

    let cancelled = false;
    void layoutSettled().then(() => {
      const scroller = scrollerRef.current;
      if (cancelled || !scroller) return;
      if (request.hash) scrollToSection(scroller, request.hash);
      // Back to the Home without a section undoes the scroll the previous entry caused. It is
      // instant, as the browser's own history restoration is: an animation here can be cut short by
      // an immediate Forward and leave the next entry a few px off its position.
      else if (hadHash) scroller.scrollTo({ top: 0, behavior: "instant" });
    });
    return () => {
      cancelled = true;
    };
  }, [key, hash, scrollerRef]);
}

// Navigates to a Home section from anywhere (mobile drawer). A section that is already in the
// address bar replaces the entry instead of stacking a duplicate, like a native anchor.
export function useHomeHashNavigate() {
  const location = useLocation();
  const navigate = useNavigate();
  const onHome = location.pathname === "/";

  return useCallback(
    (hash: string) => {
      const target = { pathname: "/", hash };
      navigate(target, {
        replace: createPath(location) === createPath(target),
        state: onHome ? location.state : undefined
      });
    },
    [location, navigate, onHome]
  );
}
