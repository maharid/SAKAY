import { useCallback, useEffect, useRef, useState } from 'react';

export interface MeasuredSize {
  width: number;
  height: number;
}

/**
 * The real size of an element, kept current with a ResizeObserver: use it on the thing that COVERS the map (a bottom sheet, a header) and
 * hand the numbers to the map as its covered area. Returns `[ref, size]`; attach `ref` to the element.
 *
 * It updates only when the whole-pixel size really changes, so a sheet that animates does not re-render the screen on every frame, and it
 * disconnects when the element goes away.
 */
export function useMeasuredSize<T extends HTMLElement = HTMLDivElement>(): [(node: T | null) => void, MeasuredSize] {
  const [size, setSize] = useState<MeasuredSize>({ width: 0, height: 0 });
  const observer = useRef<ResizeObserver | null>(null);

  const ref = useCallback((node: T | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!node) return;
    const read = () => {
      const width = Math.round(node.offsetWidth);
      const height = Math.round(node.offsetHeight);
      setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
    };
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(read);
    ro.observe(node);
    observer.current = ro;
  }, []);

  useEffect(
    () => () => {
      observer.current?.disconnect();
      observer.current = null;
    },
    []
  );

  return [ref, size];
}
