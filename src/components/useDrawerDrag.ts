import { useState, useRef, useCallback } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

export interface UseDrawerDragOptions {
  menuOpen: boolean;
  menuRef: React.RefObject<HTMLElement>;
  onClose: () => void;
}

export function useDrawerDrag({ menuOpen, menuRef, onClose }: UseDrawerDragOptions) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const dragStartYRef = useRef(0);
  const dragOffsetRef = useRef(0);
  const dragPointerIdRef = useRef<number | null>(null);
  const dragMovedRef = useRef(false);
  const suppressHandleClickRef = useRef(false);

  const resetDrag = useCallback(() => {
    dragOffsetRef.current = 0;
    dragPointerIdRef.current = null;
    dragMovedRef.current = false;
    setDragOffset(0);
    setIsDragging(false);
  }, []);

  const handleDragStart = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (!menuOpen || (event.pointerType === "mouse" && event.button !== 0)) {
        return;
      }

      dragStartYRef.current = event.clientY;
      dragOffsetRef.current = 0;
      dragPointerIdRef.current = event.pointerId;
      dragMovedRef.current = false;
      suppressHandleClickRef.current = false;
      setDragOffset(0);
      setIsDragging(true);
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [menuOpen]
  );

  const handleDragMove = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    if (dragPointerIdRef.current !== event.pointerId) return;

    const offset = Math.max(0, event.clientY - dragStartYRef.current);
    if (offset > 4) dragMovedRef.current = true;

    dragOffsetRef.current = offset;
    setDragOffset(offset);
  }, []);

  const finishDrag = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>, cancelled = false) => {
      if (dragPointerIdRef.current !== event.pointerId) return;

      const moved = dragMovedRef.current;
      const menuHeight = menuRef.current?.getBoundingClientRect().height ?? 320;
      const closeThreshold = Math.max(72, Math.min(120, menuHeight * 0.25));
      const shouldClose = !cancelled && moved && dragOffsetRef.current >= closeThreshold;

      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }

      suppressHandleClickRef.current = moved;
      dragPointerIdRef.current = null;
      dragMovedRef.current = false;
      setIsDragging(false);

      if (shouldClose) {
        onCloseRef.current();
        return;
      }

      dragOffsetRef.current = 0;
      setDragOffset(0);
    },
    [menuRef]
  );

  const handleDragHandleClick = useCallback(() => {
    if (suppressHandleClickRef.current) {
      suppressHandleClickRef.current = false;
      return;
    }

    onCloseRef.current();
  }, []);

  return {
    dragOffset,
    isDragging,
    resetDrag,
    handleDragStart,
    handleDragMove,
    finishDrag,
    handleDragHandleClick,
    dragStartYRef,
    dragOffsetRef,
    dragPointerIdRef,
    dragMovedRef,
    suppressHandleClickRef
  };
}
