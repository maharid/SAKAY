import { Router, type Request, type Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * /api/share: what the person who received a Share Live Trip link can fetch WITHOUT an account (Rule 26.1).
 *
 * The page itself reads the trip from the database function get_shared_trip_view(), which answers only for a link that is still live. A photo cannot come that
 * way (a file lives in Storage, and an anonymous visitor has no right to it), so the picture goes through here:
 *
 *   GET /api/share/:token/driver-photo
 *     1. the token has to look like a share token (32 hex characters); anything else is a plain 404, no database call
 *     2. get_shared_trip_photo_path(token) answers with the driver's profile picture ONLY while the link is live AND the trip is on (the same tests as the
 *        page, so a photo disappears with the link) and only for a path inside the driver's own folder
 *     3. the server signs that one file for a minute and sends the visitor on to it. Nothing is cached, nothing is logged but the method and the path.
 *
 * Every failure is the same empty 404 so the answer does not tell a stranger whether a token exists. The caller is limited per address in app.ts.
 */
const TOKEN = /^[0-9a-f]{32}$/;
const PHOTO_BUCKET = 'profiles';
const SIGNED_SECONDS = 60;

export interface ShareDeps {
  supabase: SupabaseClient | null;
}

const gone = (res: Response): void => {
  res.status(404).end();
};

export function createShareRouter(deps: ShareDeps): Router {
  const router = Router();

  router.get('/:token/driver-photo', async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    // the picture is shown by the Passenger app's own page, possibly from another origin than this server
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

    const token = String(req.params.token ?? '');
    if (!TOKEN.test(token) || !deps.supabase) {
      gone(res);
      return;
    }
    try {
      const { data: path, error } = await deps.supabase.rpc('get_shared_trip_photo_path', { p_token: token });
      if (error || typeof path !== 'string' || !path || path.startsWith('/') || path.includes('..')) {
        gone(res);
        return;
      }
      const { data, error: signError } = await deps.supabase.storage.from(PHOTO_BUCKET).createSignedUrl(path, SIGNED_SECONDS);
      if (signError || !data?.signedUrl) {
        gone(res);
        return;
      }
      res.redirect(302, data.signedUrl);
    } catch {
      gone(res);
    }
  });

  return router;
}

export default createShareRouter;
