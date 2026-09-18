import { useEffect, useState, type RefObject, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface PortalDropdownProps {
  open: boolean;
  anchorRef: RefObject<HTMLElement>;
  menuRef: RefObject<HTMLUListElement>;
  className: string;
  children: ReactNode;
}

interface MenuPosition {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
}

export default function PortalDropdown({
  open,
  anchorRef,
  menuRef,
  className,
  children,
}: PortalDropdownProps) {
  const [position, setPosition] = useState<MenuPosition | null>(null);

  useEffect(() => {
    if (!open) return;
    const update = () => {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (!rect) return;
      const top = rect.bottom + 4;
      setPosition({
        left: rect.left,
        top,
        width: rect.width,
        maxHeight: Math.max(80, Math.min(220, window.innerHeight - top - 16)),
      });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [anchorRef, open]);

  if (!open || !position) return null;
  return createPortal(
    <ul
      ref={menuRef}
      className={className}
      style={{
        position: "fixed",
        left: position.left,
        top: position.top,
        width: position.width,
        maxHeight: position.maxHeight,
      }}
    >
      {children}
    </ul>,
    document.body,
  );
}
