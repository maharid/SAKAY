import express, { type NextFunction, type Request, type Response } from 'express';
import { supabase } from '../config/supabase';

/**
 * /api/admin/todas/:todaId/roster: the master roster of drivers of a TODA.
 *
 * Who may use it: the LGU administrator, or the administrator of THAT TODA (the :todaId in the address must be the TODA of the signed-in
 * administrator; it is never trusted on its own). `requireAuth` + `attachActor` run before this router; the scope check below is part
 * of the router itself so that it cannot be left out by mistake.
 *
 * Failures are reported as failures. (An earlier version answered "success" with made-up in-memory rows when the database refused.)
 */
const router = express.Router({ mergeParams: true });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ENTRIES = 500;

interface RosterUploadItem {
  driver_full_name: string;
  franchise_number?: string;
  plate_number?: string;
}

function scope(req: Request, res: Response, next: NextFunction): void {
  const todaId = String(req.params.todaId ?? '');
  if (!UUID.test(todaId)) {
    res.status(400).json({ success: false, error: 'Invalid TODA id.' });
    return;
  }
  const actor = req.actor;
  const lgu = actor?.lguAdmin?.accountStatus === 'Active';
  const ownToda = actor?.todaAdmin?.accountStatus === 'Active' && actor.todaAdmin.todaId === todaId;
  if (!lgu && !ownToda) {
    res.status(403).json({ success: false, error: 'You do not have access to this TODA.' });
    return;
  }
  next();
}
router.use(scope);

const text = (v: unknown, max: number): string | null | undefined => {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string') return undefined;           // wrong type
  const t = v.replace(/[\u0000-\u001F\u007F]/g, ' ').trim();
  return t.length > max ? undefined : t || null;
};

/**
 * GET /api/admin/todas/:todaId/roster
 */
router.get('/', async (req: Request, res: Response) => {
  const todaId = String(req.params.todaId);
  if (!supabase) { res.status(503).json({ success: false, error: 'The roster is temporarily unavailable.' }); return; }
  try {
    const { data, error } = await supabase
      .from('toda_roster_entry')
      .select('*')
      .eq('toda_id', todaId)
      .order('created_at', { ascending: false });
    if (error) {
      console.error(`[RosterRoute] query error for ${todaId}:`, error.message);
      res.status(500).json({ success: false, error: 'The roster could not be loaded.' });
      return;
    }
    res.json({ success: true, count: data?.length ?? 0, data: data ?? [] });
  } catch (err) {
    console.error('[RosterRoute] GET error:', err instanceof Error ? err.message : err);
    res.status(500).json({ success: false, error: 'The roster could not be loaded.' });
  }
});

/**
 * POST /api/admin/todas/:todaId/roster
 */
router.post('/', async (req: Request, res: Response) => {
  const todaId = String(req.params.todaId);
  const entries = (req.body as { entries?: unknown } | undefined)?.entries;

  if (!Array.isArray(entries) || entries.length === 0) {
    res.status(400).json({ success: false, error: 'Invalid payload: "entries" array is required and must contain at least one item.' });
    return;
  }
  if (entries.length > MAX_ENTRIES) {
    res.status(400).json({ success: false, error: `Too many entries: at most ${MAX_ENTRIES} per upload.` });
    return;
  }

  const rows: { toda_id: string; driver_full_name: string; franchise_number: string | null; plate_number: string | null }[] = [];
  for (const raw of entries as RosterUploadItem[]) {
    const name = text(raw?.driver_full_name, 120);
    const franchise = text(raw?.franchise_number, 40);
    const plate = text(raw?.plate_number, 40);
    if (!name || franchise === undefined || plate === undefined) {
      res.status(400).json({ success: false, error: 'Every entry needs a driver_full_name (up to 120 characters); franchise_number and plate_number are optional text (up to 40).' });
      return;
    }
    rows.push({ toda_id: todaId, driver_full_name: name, franchise_number: franchise, plate_number: plate });
  }

  if (!supabase) { res.status(503).json({ success: false, error: 'The roster is temporarily unavailable.' }); return; }
  try {
    const { data, error } = await supabase.from('toda_roster_entry').insert(rows).select();
    if (error) {
      console.error('[RosterRoute] insert error:', error.message);
      res.status(500).json({ success: false, error: 'The roster could not be saved.' });
      return;
    }
    res.json({
      success: true,
      message: `Successfully registered ${data?.length ?? 0} master roster entries.`,
      count: data?.length ?? 0,
      data,
    });
  } catch (err) {
    console.error('[RosterRoute] POST error:', err instanceof Error ? err.message : err);
    res.status(500).json({ success: false, error: 'The roster could not be saved.' });
  }
});

export default router;
