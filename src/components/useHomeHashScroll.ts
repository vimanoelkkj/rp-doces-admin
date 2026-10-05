import { useEffect, useRef } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";

export interface UseHomeHashScrollOptions {
  menuOpen: boolean;
  closeMenu: () => void;
}

export function useHomeHashScroll({ menuOpen, closeMenu }: UseHomeHashScrollOptions) {
  const location = useLocation();
  const navigate = useNavigate();
  const pendingHashRef = useRef<string | null>(null);

  // Handle smooth scroll when navigating to Home with pending hash after closing mobile menu
  useEffect(() => {
    if (menuOpen) return;
    const targetHash = pendingHashRef.current;
    if (!targetHash) return;
    pendingHashRef.current = null;

    if (location.pathname !== "/") {
      navigate(`/${targetHash}`);
      return;
    }

    const prefersReduced =
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let innerFrameId: number;
    const frameId = requestAnimationFrame(() => {
      innerFrameId = requestAnimationFrame(() => {
        const id = targetHash.replace(/^#/, "");
        const el = document.getElementById(id);
        if (el) {
          el.scrollIntoView({ behavior: prefersReduced ? "auto" : "smooth" });
          window.history.replaceState(null, "", targetHash);
        }
      });
    });

    return () => {
      cancelAnimationFrame(frameId);
      cancelAnimationFrame(innerFrameId);
    };
  }, [menuOpen, location.pathname, navigate]);

  // Handle smooth scroll on direct hash change / landing on Home
  useEffect(() => {
    if (location.pathname === "/" && location.hash) {
      const targetHash = location.hash;
      const prefersReduced =
        typeof window !== "undefined" &&
        window.matchMedia &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      let innerFrameId: number;
      const frameId = requestAnimationFrame(() => {
        innerFrameId = requestAnimationFrame(() => {
          const id = targetHash.replace(/^#/, "");
          const el = document.getElementById(id);
          if (el) {
            el.scrollIntoView({ behavior: prefersReduced ? "auto" : "smooth" });
          }
        });
      });

      return () => {
        cancelAnimationFrame(frameId);
        cancelAnimationFrame(innerFrameId);
      };
    }
  }, [location.pathname, location.hash]);

  const handleStorefrontNav = (hash: string, event?: ReactMouseEvent) => {
    if (event) {
      event.preventDefault();
    }

    if (menuOpen) {
      pendingHashRef.current = hash;
      closeMenu();
      return;
    }

    const prefersReduced =
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (location.pathname === "/") {
      const id = hash.replace(/^#/, "");
      const el = document.getElementById(id);
      if (el) {
        el.scrollIntoView({ behavior: prefersReduced ? "auto" : "smooth" });
        window.history.pushState(null, "", hash);
      }
    } else {
      navigate(`/${hash}`);
    }
  };

  return {
    handleStorefrontNav,
    pendingHashRef
  };
}
