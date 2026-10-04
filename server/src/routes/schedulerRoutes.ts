import express, { Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { executeSlaCascadeRun } from '../services/slaSchedulerService';
import { createSchedulerGuard } from '../middleware/schedulerSecret';

const router = express.Router();

/**
 * Scheduler endpoints are for a cron service, never for people or browsers. The guard fails CLOSED (503) when SCHEDULER_SECRET is not
 * set (it used to fall back to a default secret that was written in this file) and compares the secret in constant time.
 */
const enforceSchedulerSecret = createSchedulerGuard();

/**
 * POST /api/scheduler/run-sla-checks
 * Executes daily SLA review checks, 30/14/3-day documentary expiry reminders with deduplication,
 * and forces documentary restriction cascade.
 */
router.post('/run-sla-checks', enforceSchedulerSecret, async (req: Request, res: Response) => {
  console.log('[Scheduler] Executing scheduled SLA and expiry cascade job via manual trigger...');

  if (!supabase) {
    res.status(503).json({
      success: false,
      error: 'Supabase client is not configured on server.',
    });
    return;
  }

  try {
    const runResult = await executeSlaCascadeRun();

    if (!runResult.success) {
      res.status(500).json({
        success: false,
        error: runResult.error || 'Execution failed',
        skipped: runResult.skipped || false,
      });
      return;
    }

    const cascadeRes = runResult.data;

    // 2. Check TODA 60-day rolling incident threshold (Rule 2.5)
    let incidentFlagsCreated = 0;
    try {
      const { data: activeTodas } = await supabase
        .from('toda')
        .select('toda_id, toda_name')
        .eq('toda_status', 'Active');

      if (activeTodas && activeTodas.length > 0) {
        for (const t of activeTodas) {
          const { data: flagCreated } = await supabase.rpc('check_toda_incident_threshold', {
            p_toda_id: t.toda_id,
          });
          if (flagCreated) incidentFlagsCreated++;
        }
      }
    } catch (incidentErr) {
      console.warn('[Scheduler Warning] Incident threshold check error:', incidentErr);
    }

    // 3. Write immutable audit log
    try {
      await supabase.from('audit_log').insert({
        action_type: 'SCHEDULED_SLA_CASCADE_EXECUTED',
        target_id: 'SYSTEM_SCHEDULER',
        actor_role: 'system_scheduler',
        details: `Automated SLA & Expiry cascade completed. Drivers restricted: ${cascadeRes?.drivers_restricted || 0}, Reminders sent: ${cascadeRes?.reminders_sent || 0}, Overdue flags: ${cascadeRes?.overdue_flags_created || 0}, TODA incident flags: ${incidentFlagsCreated}`,
        performed_at: new Date().toISOString(),
      });
    } catch (auditErr) {
      console.warn('[Scheduler Warning] Audit log write warning:', auditErr);
    }

    console.log('[Scheduler] Run completed successfully:', {
      ...cascadeRes,
      incident_flags_created: incidentFlagsCreated,
    });

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      result: cascadeRes,
      toda_incident_flags_created: incidentFlagsCreated,
    });
  } catch (err: any) {
    console.error('[Scheduler Fatal Error]:', err);
    res.status(500).json({
      success: false,
      error: err.message || 'Scheduler job failed',
    });
  }
});

export default router;
