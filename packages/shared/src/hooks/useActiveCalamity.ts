import { useEffect, useState } from 'react';
import type { RpcCapableClient } from '../utils/restrictionUtils';
import { fetchActiveCalamity } from '../utils/tripSafety';
import type { ActiveCalamity } from '../utils/tripSafety';

/**
 * The calamity the LGU Administrator declared (Rules 15.4, 29.6), for a banner while it lasts. The database answers; the poll is slow (a calamity is declared by a person, not by a
 * second) and stops with the screen. A failed call reads as "no calamity" until the next poll (the banner is a convenience; the announcement itself is in the notices).
 */
export function useActiveCalamity(client: RpcCapableClient, intervalMs = 60_000): ActiveCalamity {
  const [calamity, setCalamity] = useState<ActiveCalamity>({ active: false });

  useEffect(() => {
    let alive = true;
    const read = () => {
      void fetchActiveCalamity(client).then((c) => {
        if (alive) setCalamity(c);
      });
    };
    read();
    const timer = setInterval(read, intervalMs);
    const onVisible = () => {
      if (document.visibilityState === 'visible') read();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [client, intervalMs]);

  return calamity;
}
