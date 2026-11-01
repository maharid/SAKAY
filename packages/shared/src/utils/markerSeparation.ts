/**
 * Pins that stand almost on the same spot (the person at the pickup, the driver arriving there, a trip that ends where the person is) would hide one another. This works out how far
 * each pin's HEAD leans sideways so the heads stay apart while every tip stays on its true position: only the picture changes, never a coordinate.
 *
 * Pins whose tips are close on the screen form a group; a group's heads are spread in a row, left to right in the order the tips lie (and, once a group is formed, in the order it was
 * first spread, so a pin that drifts past another does not jump from side to side). A group breaks up again only when its pins are clearly apart, so a position that hovers
 * around the limit does not flicker. It works in screen pixels, so what counts as "the same spot" follows the zoom: far away, nearby places lean apart; close up, only really close
 * ones do.
 */

/** Pins closer than this on the screen (tip to tip) are spread apart; they stay spread until they are farther apart than the exit distance */
export const SEPARATE_ENTER_PX = 64;
export const SEPARATE_EXIT_PX = 76;
/** The distance between the centres of two neighbouring heads once spread (a head is about 40 px wide) */
export const SEPARATE_SPACING_PX = 46;

export interface PinPoint {
  id: string;
  /** where the TIP of the pin is on the screen, in pixels */
  x: number;
  y: number;
}

/** The groups that were spread last time, each in the order of its heads from left to right: pass the previous answer back in */
export type PinGroups = string[][];

export interface Separation {
  /** every pin that is in a group: how far its head leans (negative: left; 0: stays above its tip). A pin that is not here stands straight. */
  leans: Record<string, number>;
  groups: PinGroups;
}

export function separatePins(pins: PinPoint[], previous: PinGroups = []): Separation {
  const usable = pins.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  const parent = usable.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const wasTogether = (a: string, b: string) => previous.some((g) => g.includes(a) && g.includes(b));
  for (let i = 0; i < usable.length; i += 1) {
    for (let j = i + 1; j < usable.length; j += 1) {
      const limit = wasTogether(usable[i].id, usable[j].id) ? SEPARATE_EXIT_PX : SEPARATE_ENTER_PX;
      if (Math.hypot(usable[i].x - usable[j].x, usable[i].y - usable[j].y) < limit) parent[find(i)] = find(j);
    }
  }

  const members = new Map<number, PinPoint[]>();
  usable.forEach((pin, i) => {
    const root = find(i);
    members.set(root, [...(members.get(root) ?? []), pin]);
  });

  const leans: Record<string, number> = {};
  const groups: PinGroups = [];
  for (const group of members.values()) {
    if (group.length < 2) continue;
    const byId = new Map(group.map((p) => [p.id, p]));
    // the pins that were already spread keep their places in the row; a newcomer goes where its tip lies among them
    const kept = previous.flatMap((g) => g.filter((id) => byId.has(id))).filter((id, i, all) => all.indexOf(id) === i);
    const order = [...kept];
    for (const pin of group) {
      if (order.includes(pin.id)) continue;
      const at = order.filter((id) => (byId.get(id) as PinPoint).x <= pin.x).length;
      order.splice(at, 0, pin.id);
    }
    // a group that was not spread before has no kept order: it is simply left to right by tip
    if (kept.length === 0) order.sort((a, b) => (byId.get(a) as PinPoint).x - (byId.get(b) as PinPoint).x);
    order.forEach((id, i) => {
      leans[id] = (i - (order.length - 1) / 2) * SEPARATE_SPACING_PX;
    });
    groups.push(order);
  }
  return { leans, groups };
}
