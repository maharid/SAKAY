import { useEffect, useState } from 'react';

export interface SafeAreaPx {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

const ZERO: SafeAreaPx = { top: 0, bottom: 0, left: 0, right: 0 };

/** The device's safe areas (notch, home indicator) in px, as the app's own --safe-area-* variables currently resolve them */
function readSafeArea(): SafeAreaPx {
  if (typeof document === 'undefined' || !document.body) return ZERO;
  const probe = document.createElement('div');
  probe.setAttribute('aria-hidden', 'true');
  probe.style.cssText =
    'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
    'padding:var(--safe-area-top,0px) var(--safe-area-right,0px) var(--safe-area-bottom,0px) var(--safe-area-left,0px)';
  document.body.appendChild(probe);
  const style = getComputedStyle(probe);
  const px = (v: string) => (Number.isFinite(parseFloat(v)) ? Math.round(parseFloat(v)) : 0);
  const read: SafeAreaPx = { top: px(style.paddingTop), right: px(style.paddingRight), bottom: px(style.paddingBottom), left: px(style.paddingLeft) };
  document.body.removeChild(probe);
  return read;
}

const same = (a: SafeAreaPx, b: SafeAreaPx) => a.top === b.top && a.bottom === b.bottom && a.left === b.left && a.right === b.right;

/**
 * The safe areas in px, for a map whose camera has to keep clear of the notch and the home indicator. It is read again when the window is
 * resized or the phone is turned (the numbers change), and the state changes only when they really do.
 */
export function useSafeAreaInsets(): SafeAreaPx {
  const [insets, setInsets] = useState<SafeAreaPx>(readSafeArea);

  useEffect(() => {
    let frame: number | null = null;
    const update = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = null;
        const next = readSafeArea();
        setInsets((prev) => (same(prev, next) ? prev : next));
      });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, []);

  return insets;
}
