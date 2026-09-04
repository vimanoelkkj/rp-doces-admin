import { useEffect } from "react";

type ScrollSnapshot = {
  scrollY: number;
  htmlOverflow: string;
  htmlOverscrollBehavior: string;
  bodyOverflow: string;
  bodyOverscrollBehavior: string;
  bodyPosition: string;
  bodyTop: string;
  bodyLeft: string;
  bodyRight: string;
  bodyWidth: string;
};

let lockCount = 0;
let snapshot: ScrollSnapshot | null = null;

function acquirePageScrollLock(): () => void {
  lockCount += 1;

  if (lockCount === 1) {
    const root = document.documentElement;
    const body = document.body;
    const scrollY = window.scrollY;

    snapshot = {
      scrollY,
      htmlOverflow: root.style.overflow,
      htmlOverscrollBehavior: root.style.overscrollBehavior,
      bodyOverflow: body.style.overflow,
      bodyOverscrollBehavior: body.style.overscrollBehavior,
      bodyPosition: body.style.position,
      bodyTop: body.style.top,
      bodyLeft: body.style.left,
      bodyRight: body.style.right,
      bodyWidth: body.style.width
    };

    root.style.overflow = "hidden";
    root.style.overscrollBehavior = "none";
    body.style.overflow = "hidden";
    body.style.overscrollBehavior = "none";
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.width = "100%";
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    lockCount = Math.max(0, lockCount - 1);
    if (lockCount !== 0 || !snapshot) return;

    const root = document.documentElement;
    const body = document.body;
    const previous = snapshot;
    snapshot = null;

    root.style.overflow = previous.htmlOverflow;
    root.style.overscrollBehavior = previous.htmlOverscrollBehavior;
    body.style.overflow = previous.bodyOverflow;
    body.style.overscrollBehavior = previous.bodyOverscrollBehavior;
    body.style.position = previous.bodyPosition;
    body.style.top = previous.bodyTop;
    body.style.left = previous.bodyLeft;
    body.style.right = previous.bodyRight;
    body.style.width = previous.bodyWidth;

    window.scrollTo(0, previous.scrollY);
  };
}

export function usePageScrollLock(active = true): void {
  useEffect(() => {
    if (!active) return;
    return acquirePageScrollLock();
  }, [active]);
}
