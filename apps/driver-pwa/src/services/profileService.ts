import { SIGNED_URL_TTL, signedStorageUrl } from '@sakay/shared';
import type { OwnMarkerProfile } from '@sakay/shared';

import { supabase } from './supabaseClient';

const KEEP_MS = 2 * 60 * 1000;
let kept: { at: number; value: Promise<OwnMarkerProfile> } | null = null;

/**
 * The signed-in driver's own name and profile picture, for the pin that shows where they are on the map. Read once and kept for a couple of minutes, so the screens that each hold a
 * map do not each ask again; a picture they just changed shows within that time. Without a signed-in driver (or when it cannot be read) the pin shows no picture.
 */
export function fetchOwnMarkerProfile(): Promise<OwnMarkerProfile> {
  if (kept && Date.now() - kept.at < KEEP_MS) return kept.value;
  const value = (async (): Promise<OwnMarkerProfile> => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return {};
    const { data: profile } = await supabase.from('driver').select('full_name, profile_photo_url').eq('auth_user_id', user.id).maybeSingle();
    const name = profile?.full_name || (user.user_metadata?.full_name as string | undefined) || '';
    const photoUrl = (await signedStorageUrl(supabase, 'profiles', profile?.profile_photo_url, SIGNED_URL_TTL.avatar)) || null;
    return { name, photoUrl };
  })().catch((): OwnMarkerProfile => ({}));
  kept = { at: Date.now(), value };
  return value;
}
