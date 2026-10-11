import { useCallback, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

/** How far (px) a drag must travel before it opens or closes the sheet */
export const SHEET_DRAG_THRESHOLD_PX = 40;
/** The sheet follows the finger no further than this (px), so it can never be pulled off screen */
export const SHEET_MAX_DRAG_PX = 180;
/** A press that moves less than this (px) is a tap, not a drag */
const TAP_SLOP_PX = 8;

export type SheetDragOutcome = 'expand' | 'collapse' | 'stay';

/** What a finished drag asks of the sheet: up (negative) opens it, down (positive) closes it, anything shorter than the threshold changes nothing. */
export function resolveSheetDrag(deltaY: number, threshold = SHEET_DRAG_THRESHOLD_PX): SheetDragOutcome {
  if (deltaY <= -threshold) return 'expand';
  if (deltaY >= threshold) return 'collapse';
  return 'stay';
}

const clampDrag = (deltaY: number) => Math.max(-SHEET_MAX_DRAG_PX, Math.min(SHEET_MAX_DRAG_PX, deltaY));

export interface SheetHandleProps {
  onPointerDown: (e: PointerEvent<HTMLElement>) => void;
  onPointerMove: (e: PointerEvent<HTMLElement>) => void;
  onPointerUp: (e: PointerEvent<HTMLElement>) => void;
  onPointerCancel: (e: PointerEvent<HTMLElement>) => void;
  onClick: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
  'aria-expanded': boolean;
}

export interface SheetHandle {
  /** How far the sheet is being dragged right now (px, signed): use it for translateY, and switch transitions off while `dragging` */
  dragY: number;
  dragging: boolean;
  /** Spread onto the handle (a <button>): drag, tap, and Arrow Up / Arrow Down all work from it */
  handleProps: SheetHandleProps;
}

/**
 * The behaviour of a bottom sheet's handle. Tapping toggles; dragging up opens, dragging down closes; the arrow keys do the same.
 *
 * Only the handle takes part: the sheet's content scrolls on its own and never starts a drag, so scrolling and dragging cannot fight.
 * A drag ends in a click on the same element in some browsers; that click is swallowed here, otherwise it would undo the drag.
 * Pointer events only (touch, pen and mouse alike) so one gesture is never handled twice; give the handle `touch-action: none`.
 */
export function useSheetHandle(expanded: boolean, onChange: (expanded: boolean) => void): SheetHandle {
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const gesture = useRef({ active: false, startY: 0, delta: 0, moved: false });

  const finish = useCallback(
    (apply: boolean) => {
      const g = gesture.current;
      if (!g.active) return;
      g.active = false;
      setDragging(false);
      setDragY(0);
      if (!apply) return;
      const outcome = resolveSheetDrag(g.delta);
      if (outcome === 'expand' && !expanded) onChange(true);
      else if (outcome === 'collapse' && expanded) onChange(false);
    },
    [expanded, onChange]
  );

  const handleProps: SheetHandleProps = {
    onPointerDown: (e) => {
      gesture.current = { active: true, startY: e.clientY, delta: 0, moved: false };
      setDragging(true);
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* capture is a nicety: without it the drag still works while the pointer stays on the handle */
      }
    },
    onPointerMove: (e) => {
      const g = gesture.current;
      if (!g.active) return;
      g.delta = e.clientY - g.startY;
      if (Math.abs(g.delta) > TAP_SLOP_PX) g.moved = true;
      setDragY(clampDrag(g.delta));
    },
    onPointerUp: () => finish(true),
    onPointerCancel: () => finish(false),
    onClick: () => {
      if (gesture.current.moved) {
        gesture.current.moved = false; // this click is the end of a drag, not a tap
        return;
      }
      onChange(!expanded);
    },
    onKeyDown: (e) => {
      if (e.key === 'ArrowUp' && !expanded) {
        e.preventDefault();
        onChange(true);
      } else if (e.key === 'ArrowDown' && expanded) {
        e.preventDefault();
        onChange(false);
      }
    },
    'aria-expanded': expanded,
  };

  return { dragY, dragging, handleProps };
}
