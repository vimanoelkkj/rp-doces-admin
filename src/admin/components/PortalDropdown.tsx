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
  top?: number;
  bottom?: number;
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

      const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
      const minMargin = 8;

      // Clamping horizontal: garante que não ultrapasse as margens da viewport
      const width = Math.min(rect.width, Math.max(120, viewportWidth - minMargin * 2));
      let left = rect.left;
      if (left + width > viewportWidth - minMargin) {
        left = Math.max(minMargin, viewportWidth - minMargin - width);
      }
      if (left < minMargin) {
        left = minMargin;
      }

      // Flip vertical: se o espaço abaixo for insuficiente e houver mais espaço acima
      const spaceBelow = viewportHeight - rect.bottom - 16;
      const spaceAbove = rect.top - 16;
      const openUpwards = spaceBelow < 160 && spaceAbove > spaceBelow;

      if (openUpwards) {
        const maxHeight = Math.max(80, Math.min(220, spaceAbove));
        setPosition({
          left,
          bottom: Math.max(8, viewportHeight - rect.top + 4),
          width,
          maxHeight,
        });
      } else {
        const top = rect.bottom + 4;
        const maxHeight = Math.max(80, Math.min(220, spaceBelow));
        setPosition({
          left,
          top,
          width,
          maxHeight,
        });
      }
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
        top: position.top !== undefined ? position.top : undefined,
        bottom: position.bottom !== undefined ? position.bottom : undefined,
        width: position.width,
        maxHeight: position.maxHeight,
      }}
    >
      {children}
    </ul>,
    document.body,
  );
}
