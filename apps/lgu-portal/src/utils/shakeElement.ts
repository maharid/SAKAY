/**
 * A short sideways shake that draws the eye to a field that needs attention (about 0.4 seconds, once). It only moves the field with a transform, so nothing
 * around it shifts, and it does nothing at all when the person has asked their device for reduced motion.
 */
export const shakeElement = (element: HTMLElement | null): void => {
  if (!element || typeof element.animate !== 'function') return;
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  element.animate(
    [
      { transform: 'translateX(0)' },
      { transform: 'translateX(-6px)' },
      { transform: 'translateX(6px)' },
      { transform: 'translateX(-4px)' },
      { transform: 'translateX(4px)' },
      { transform: 'translateX(0)' },
    ],
    { duration: 400, easing: 'ease-in-out' }
  );
};
