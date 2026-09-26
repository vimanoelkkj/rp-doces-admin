import { useEffect, useRef, useState } from "react";

// Anti-piscada do carregamento: o skeleton só aparece se a espera passar de
// `delayMs` (carregamento rápido não mostra nada) e, uma vez visível, fica
// pelo menos `minVisibleMs` (não surge e some num piscar).
export const SKELETON_DELAY_MS = 150;
export const SKELETON_MIN_VISIBLE_MS = 400;

export function useSkeletonVisibility(
  loading: boolean,
  delayMs = SKELETON_DELAY_MS,
  minVisibleMs = SKELETON_MIN_VISIBLE_MS,
): boolean {
  const [visible, setVisible] = useState(false);
  const shownAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (loading) {
      if (shownAtRef.current !== null) return;
      const timer = setTimeout(() => {
        shownAtRef.current = Date.now();
        setVisible(true);
      }, delayMs);
      return () => clearTimeout(timer);
    }

    if (shownAtRef.current === null) return;
    const restante = Math.max(0, shownAtRef.current + minVisibleMs - Date.now());
    const timer = setTimeout(() => {
      shownAtRef.current = null;
      setVisible(false);
    }, restante);
    return () => clearTimeout(timer);
  }, [loading, delayMs, minVisibleMs]);

  return visible;
}
