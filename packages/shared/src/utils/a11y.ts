import type { KeyboardEvent } from 'react';

/**
 * For an element that acts as a button but is not a <button> (role="button" tabIndex={0}): Enter or Space does what a click does, as it
 * does on a real button. Only the element itself reacts, so typing inside a field it contains is left alone. Prefer a real <button> or
 * MUI ButtonBase where the markup allows; this is for cards that must stay a <div>.
 */
export function activateWithKeyboard(event: KeyboardEvent<HTMLElement>): void {
  if ((event.key === 'Enter' || event.key === ' ') && event.target === event.currentTarget) {
    event.preventDefault();
    event.currentTarget.click();
  }
}

/**
 * `sx` for a small control whose drawn size is smaller than a comfortable touch target: it grows the tappable area by `extra` px on
 * every side without moving or resizing what is drawn. Spread it before any explicit `position` in the same `sx`.
 */
export function extendTapArea(extra = 8) {
  return {
    position: 'relative',
    '&::after': { content: '""', position: 'absolute', top: -extra, right: -extra, bottom: -extra, left: -extra },
  } as const;
}
