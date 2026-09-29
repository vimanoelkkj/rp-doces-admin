import { useEffect, useState, useRef } from "react";
import { useLocation } from "react-router-dom";
import "./PageTransition.css";

interface PageTransitionProps {
  children: React.ReactNode;
  locationKey: string;
}

export default function PageTransition({ children }: PageTransitionProps) {
  const location = useLocation();
  const [currentChildren, setCurrentChildren] = useState(children);
  const [currentPath, setCurrentPath] = useState(location.pathname);
  const [phase, setPhase] = useState<"idle" | "out" | "in">("idle");
  const nextChildren = useRef(children);
  const nextPath = useRef(location.pathname);

  useEffect(() => {
    // O destino pendente acompanha sempre a navegação mais recente, mesmo com a animação em curso
    nextChildren.current = children;
    nextPath.current = location.pathname;
    if (location.pathname === currentPath) {
      // Mesma rota (ex: mudança de hash) — atualiza direto sem animação
      setCurrentChildren(children);
    }
  }, [location.pathname, children, currentPath]);

  useEffect(() => {
    // Só anima em mudança de PATHNAME (não hash). Ao fim de cada animação (phase volta a "idle")
    // a URL é reavaliada: se mudou no meio dela, inicia nova saída até o conteúdo alcançá-la.
    if (phase === "idle" && location.pathname !== currentPath) setPhase("out");
  }, [phase, location.pathname, currentPath]);

  useEffect(() => {
    if (phase === "out") {
      const timer = setTimeout(() => {
        window.scrollTo(0, 0);
        setCurrentChildren(nextChildren.current);
        setCurrentPath(nextPath.current);
        setPhase("in");
      }, 350);
      return () => clearTimeout(timer);
    }

    if (phase === "in") {
      const timer = setTimeout(() => {
        setPhase("idle");
      }, 350);
      return () => clearTimeout(timer);
    }
  }, [phase]);

  return <div className={`page-transition page-transition--${phase}`}>{currentChildren}</div>;
}
