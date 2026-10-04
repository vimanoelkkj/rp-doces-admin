import { useEffect, useState, type RefObject } from "react";
import { createPortal } from "react-dom";

interface BackToTopButtonProps {
  /** Elemento que rola (o `main` da Home). */
  scrollerRef: RefObject<HTMLElement | null>;
}

// Botão "voltar ao topo": aparece depois de rolar o elemento e leva de volta ao início. Fica num portal no
// `body`. O estado de scroll mora aqui para a página não renderizar de novo a cada vez que ele muda.
export default function BackToTopButton({ scrollerRef }: BackToTopButtonProps) {
  const [showBackToTop, setShowBackToTop] = useState(false);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;

    const handleScroll = () => {
      setShowBackToTop(scroller.scrollTop > 1);
    };

    handleScroll();
    scroller.addEventListener("scroll", handleScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", handleScroll);
  }, [scrollerRef]);

  const scrollToTop = () => {
    scrollerRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  };

  return createPortal(
    <button
      type="button"
      className={`back-to-top ${showBackToTop ? "back-to-top--visible" : ""}`}
      onClick={scrollToTop}
      aria-label="Voltar ao topo"
    >
      ↑
    </button>,
    document.body
  );
}
