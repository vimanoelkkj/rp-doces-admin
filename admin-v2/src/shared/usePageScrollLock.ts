import { useEffect } from "react";

type ScrollSnapshot = {
  htmlOverflow: string;
  htmlOverscrollBehavior: string;
  bodyOverflow: string;
  bodyOverscrollBehavior: string;
};

let lockCount = 0;
let snapshot: ScrollSnapshot | null = null;

export function acquirePageScrollLock(): () => void {
  lockCount += 1;

  if (lockCount === 1) {
    const root = document.documentElement;
    const body = document.body;

    snapshot = {
      htmlOverflow: root.style.overflow,
      htmlOverscrollBehavior: root.style.overscrollBehavior,
      bodyOverflow: body.style.overflow,
      bodyOverscrollBehavior: body.style.overscrollBehavior
    };

    /*
     * Não fixe o body para travar o scroll. Em navegadores mobile, combinar
     * position:fixed com top negativo faz a altura visual da página divergir
     * da altura rolável quando um drawer/modal fecha. O resultado é conteúdo
     * cortado seguido por uma área vazia enorme.
     *
     * Esconder o overflow mantém a posição atual sem deslocar o documento.
     */
    root.style.overflow = "hidden";
    root.style.overscrollBehavior = "none";
    body.style.overflow = "hidden";
    body.style.overscrollBehavior = "none";
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
  };
}

export function usePageScrollLock(active = true): void {
  useEffect(() => {
    if (!active) return;
    return acquirePageScrollLock();
  }, [active]);
}
