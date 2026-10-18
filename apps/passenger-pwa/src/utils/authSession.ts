/**
 * The id of the Supabase auth session a login token belongs to (the token's `session_id` claim), or null when the token has none or is not
 * readable. The database compares this with the passenger's current login (Rules 4.5 / 29.1); the app only reads it to notice that this phone's
 * login was never recorded and to record it.
 */
export const authSessionIdFromAccessToken = (accessToken: string | null | undefined): string | null => {
  if (!accessToken) return null;
  const part = accessToken.split('.')[1];
  if (!part) return null;
  try {
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const claims = JSON.parse(atob(padded)) as { session_id?: unknown };
    return typeof claims.session_id === 'string' ? claims.session_id : null;
  } catch {
    return null;
  }
};
