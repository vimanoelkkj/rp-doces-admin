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

// Pilha global de modais ativos (mais de um quando um modal abre outro por
// cima, ex.: histórico sobre o detalhe do pedido). Um único listener de
// teclado no documento sempre age só sobre o topo da pilha: Esc fecha
// somente o modal mais recente, e o focus trap (Tab/Shift+Tab) circula só
// dentro do container dele — os modais abaixo ficam inertes até o de cima
// fechar.
interface ModalStackEntry {
  close: () => void;
  container: HTMLElement | null;
}

const modalStack: ModalStackEntry[] = [];

function focaveis(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  );
}

function onKeyDown(event: KeyboardEvent) {
  const topo = modalStack[modalStack.length - 1];
  if (!topo) return;

  if (event.key === "Escape") {
    event.stopPropagation();
    topo.close();
    return;
  }

  if (event.key === "Tab" && topo.container) {
    const itens = focaveis(topo.container);
    if (itens.length === 0) return;
    const primeiro = itens[0];
    const ultimo = itens[itens.length - 1];
    if (event.shiftKey && document.activeElement === primeiro) {
      event.preventDefault();
      ultimo.focus();
    } else if (!event.shiftKey && document.activeElement === ultimo) {
      event.preventDefault();
      primeiro.focus();
    }
  }
}

export function useAdminModal(active: boolean, onClose: () => void) {
  const startedOnBackdrop = useRef(false);
  const endedOnBackdrop = useRef(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!active) return;
    lockPageScroll();
    return unlockPageScroll;
  }, [active]);

  useEffect(() => {
    if (!active) return;

    const returnFocusTo = document.activeElement as HTMLElement | null;
    const entry: ModalStackEntry = {
      close: () => onCloseRef.current(),
      container: containerRef.current,
    };
    modalStack.push(entry);
    if (modalStack.length === 1) {
      document.addEventListener("keydown", onKeyDown, true);
    }

    // Move o foco pra dentro do modal recém-aberto (primeiro elemento
    // focável), senão o Tab continuaria a partir de onde o clique que abriu
    // o modal deixou o foco, fora da pilha.
    const primeiroFocavel = containerRef.current ? focaveis(containerRef.current)[0] : null;
    primeiroFocavel?.focus();

    return () => {
      const index = modalStack.indexOf(entry);
      if (index !== -1) modalStack.splice(index, 1);
      if (modalStack.length === 0) {
        document.removeEventListener("keydown", onKeyDown, true);
      }
      // Devolve o foco pra quem abriu este modal (ex.: o botão "Histórico"),
      // desde que o elemento ainda exista no DOM.
      if (returnFocusTo && document.contains(returnFocusTo)) {
        returnFocusTo.focus();
      }
    };
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

  return { onPointerDown, onPointerUp, onPointerCancel, onClick, ref: containerRef };
}
