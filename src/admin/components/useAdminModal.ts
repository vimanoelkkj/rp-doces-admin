import {
  useEffect,
  useRef,
  type MouseEventHandler,
  type PointerEventHandler,
} from "react";

interface SavedBodyState {
  cssText: string;
  scrollX: number;
  scrollY: number;
}

let modalLocks = 0;
let savedBodyState: SavedBodyState | null = null;

function lockPageScroll() {
  modalLocks += 1;
  if (modalLocks > 1) return;

  const body = document.body;
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;
  const scrollbarWidth = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
  const currentPadding = Number.parseFloat(window.getComputedStyle(body).paddingRight) || 0;

  savedBodyState = { cssText: body.style.cssText, scrollX, scrollY };
  body.style.position = "fixed";
  body.style.top = `-${scrollY}px`;
  body.style.left = `-${scrollX}px`;
  body.style.width = "100%";
  body.style.boxSizing = "border-box";
  body.style.overflow = "hidden";
  if (scrollbarWidth > 0) body.style.paddingRight = `${currentPadding + scrollbarWidth}px`;
}

function unlockPageScroll() {
  modalLocks = Math.max(0, modalLocks - 1);
  if (modalLocks !== 0 || !savedBodyState) return;

  const { cssText, scrollX, scrollY } = savedBodyState;
  savedBodyState = null;
  document.body.style.cssText = cssText;
  // `html { scroll-behavior: smooth }` é global (âncoras do site) — sem
  // `behavior: "instant"` explícito, essa restauração técnica herdava o
  // smooth e a tela visivelmente "pulava pro topo e deslizava de volta"
  // ao fechar qualquer modal.
  window.scrollTo({ left: scrollX, top: scrollY, behavior: "instant" });
}

export function useAdminModal(active: boolean, onClose: () => void) {
  const startedOnBackdrop = useRef(false);
  const endedOnBackdrop = useRef(false);

  useEffect(() => {
    if (!active) return;
    lockPageScroll();
    return unlockPageScroll;
  }, [active]);

  const onPointerDown: PointerEventHandler<HTMLDivElement> = (event) => {
    startedOnBackdrop.current = event.target === event.currentTarget;
    endedOnBackdrop.current = false;
  };

  const onPointerUp: PointerEventHandler<HTMLDivElement> = (event) => {
    endedOnBackdrop.current = event.target === event.currentTarget;
  };

  const onPointerCancel: PointerEventHandler<HTMLDivElement> = () => {
    startedOnBackdrop.current = false;
    endedOnBackdrop.current = false;
  };

  const onClick: MouseEventHandler<HTMLDivElement> = (event) => {
    const genuineBackdropClick =
      startedOnBackdrop.current &&
      endedOnBackdrop.current &&
      event.target === event.currentTarget;
    startedOnBackdrop.current = false;
    endedOnBackdrop.current = false;
    if (genuineBackdropClick) onClose();
  };

  return { onPointerDown, onPointerUp, onPointerCancel, onClick };
}
