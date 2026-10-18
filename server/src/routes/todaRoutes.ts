import { Router, Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { forbidDirectTodaDecision } from './disabledEndpoints';

const router = Router();

const approvedTodasStore = new Set<string>(['singkotoda', 'stoda', '5a078601-4349-4dfd-ac25-6dbeaccea3cd']);

export function markTodaApprovedInServer(idOrAcronym: string) {
  if (idOrAcronym) {
    approvedTodasStore.add(idOrAcronym.toLowerCase());
  }
}

// ============================================================================
// 1. LIST TODA APPLICATIONS (Pending Verification / Review / Return / All)
// ============================================================================
router.get('/applications', async (req: Request, res: Response) => {
  try {
    const { status, barangay, search } = req.query;

    if (supabase) {
      let query = supabase
        .from('toda')
        .select('*')
        .order('created_at', { ascending: false });

      if (status && status !== 'All') {
        query = query.eq('account_status', status);
      } else {
        // By default on applications page, include all non-active or all records if requested
        // Or show pending / under review / returned / deactivated
      }

      if (barangay && barangay !== 'All') {
        query = query.eq('barangay', barangay);
      }

      const { data, error } = await query;

      if (!error && data) {
        // Format database rows into structured application records
        const formatted = data.map((row: any) => ({
          id: row.toda_id,
          name: row.toda_name,
          acronym: row.toda_acronym || '',
          registrationNumber: row.registration_number,
          dateEstablished: row.date_established || '',
          representative: row.president_name || 'Designated Representative',
          phone: row.contact_number || row.president_contact || '+63 900 000 0000',
          email: row.email || '',
          barangay: row.barangay || 'Calapan City',
          terminalLocation: row.service_coverage_area || 'Calapan City Terminal',
          terminalLatitude: row.terminal_latitude || 13.4115,
          terminalLongitude: row.terminal_longitude || 121.1803,
          serviceCoverageArea: row.service_coverage_area || '',
          memberCount: row.active_driver_count || row.registered_tricycle_count || 0,
          registeredTricycleCount: row.registered_tricycle_count || 0,
          activeDriverCount: row.active_driver_count || 0,
          barangayClearanceExpiry: row.certificate_expiry
            ? new Date(row.certificate_expiry).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
            : 'Dec 31, 2026',
          clearanceStatus: row.account_status === 'Active' ? 'Valid' : 'Under Review',
          submittedDate: row.created_at
            ? new Date(row.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
            : 'Recent',
          status: row.account_status === 'Active'
            ? 'Approved'
            : row.account_status === 'Deactivated'
            ? 'Declined'
            : 'Pending',
          officers: {
            president: row.president_name || 'N/A',
            presidentContact: row.president_contact || row.contact_number || 'N/A',
            vicePresident: row.vice_president_name || 'N/A',
            vicePresidentContact: row.vice_president_contact || 'N/A',
            secretary: row.secretary_name || 'N/A',
            secretaryContact: row.secretary_contact || 'N/A',
            treasurer: row.treasurer_name || 'N/A',
            treasurerContact: row.treasurer_contact || 'N/A',
          },
          documents: [
            {
              name: `Barangay Clearance (${row.barangay || 'Calapan City'})`,
              type: 'PDF Document (Official LGU Seal)',
              date: row.created_at ? new Date(row.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '2026',
              status: 'Verified',
              url: null,
            },
            {
              name: 'SEC / CDA Certificate of Registration',
              type: 'Certified True Copy',
              date: row.date_established || '2024',
              status: 'Verified',
              url: null,
            },
            {
              name: `Official Driver Master Roster (${row.active_driver_count || row.registered_tricycle_count || 0} Units)`,
              type: 'Master Roster Ledger (PDF)',
              date: row.created_at ? new Date(row.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '2026',
              status: 'Verified',
              url: null,
            },
            {
              name: "Mayor's Permit & Franchise Clearance",
              type: 'Official Municipal Permit',
              date: '2026',
              status: 'Verified',
              url: null,
            },
          ],
        }));

        let filtered = formatted;
        if (search) {
          const q = (search as string).toLowerCase();
          filtered = filtered.filter(
            (t) =>
              t.name.toLowerCase().includes(q) ||
              t.representative.toLowerCase().includes(q) ||
              t.barangay.toLowerCase().includes(q) ||
              t.id.toLowerCase().includes(q)
          );
        }

        return res.json({ success: true, data: filtered });
      }
    }

    return res.json({ success: true, data: [] });
  } catch (err) {
    console.error('[todaRoutes] /applications error:', err);
    return res.status(500).json({ success: false, error: (err as Error).message });
  }
});

// ============================================================================
// 2. LIST ACCREDITED TODAS (account_status = 'Active')
// ============================================================================
router.get('/accredited', async (req: Request, res: Response) => {
  try {
    const { search } = req.query;

    if (supabase) {
      const { data, error } = await supabase
        .from('toda')
        .select('*')
        .eq('account_status', 'Active')
        .order('toda_name', { ascending: true });

      if (!error && data) {
        let result = data;
        if (search) {
          const q = (search as string).toLowerCase();
          result = result.filter(
            (t: any) =>
              t.toda_name.toLowerCase().includes(q) ||
              (t.barangay && t.barangay.toLowerCase().includes(q)) ||
              (t.president_name && t.president_name.toLowerCase().includes(q)) ||
              (t.registration_number && t.registration_number.toLowerCase().includes(q))
          );
        }
        return res.json({ success: true, data: result });
      }
    }

    return res.json({ success: true, data: [] });
  } catch (err) {
    console.error('[todaRoutes] /accredited error:', err);
    return res.status(500).json({ success: false, error: (err as Error).message });
  }
});

// ============================================================================
// 3. GET SINGLE TODA DETAILS
// ============================================================================
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    if (supabase) {
      const { data, error } = await supabase
        .from('toda')
        .select('*')
        .eq('toda_id', id)
        .maybeSingle();

      if (!error && data) {
        return res.json({ success: true, data });
      }
    }

    return res.status(404).json({ success: false, error: 'TODA record not found' });
  } catch (err) {
    return res.status(500).json({ success: false, error: (err as Error).message });
  }
});

// ============================================================================
// 3.1. SUBMIT TODA REGISTRATION APPLICATION
// ============================================================================
router.post('/register', async (req: Request, res: Response) => {
  try {
    const {
      toda_name,
      toda_acronym,
      registration_number,
      date_established,
      active_drivers,
      registered_tricycles,
      terminal_location,
      barangay,
      service_coverage_area,
      president_name,
      email,
      contact_number,
      barangay_clearance_url,
      accredited_drivers_url,
      auth_user_id,
    } = req.body;

    if (!toda_name || !president_name || !contact_number) {
      return res.status(400).json({
        success: false,
        error: 'Required fields: toda_name, president_name, contact_number',
      });
    }

    if (supabase) {
      // 1. Insert into public.toda
      const { data: todaData, error: todaErr } = await supabase
        .from('toda')
        .insert([
          {
            toda_name: toda_name.trim(),
            toda_acronym: toda_acronym ? toda_acronym.trim() : toda_name.slice(0, 4).toUpperCase(),
            registration_number: registration_number || `REG-${Date.now()}`,
            date_established: date_established || '2024-01-01',
            active_driver_count: parseInt(active_drivers) || 1,
            registered_tricycle_count: parseInt(registered_tricycles) || 1,
            terminal_latitude: 13.4117,
            terminal_longitude: 121.1803,
            barangay: barangay || 'San Vicente Central',
            service_coverage_area: service_coverage_area || terminal_location || 'Calapan City',
            president_name: president_name.trim(),
            president_contact: contact_number,
            account_status: 'Pending Verification',
            barangay_clearance_url: barangay_clearance_url || null,
            accredited_drivers_url: accredited_drivers_url || null,
          },
        ])
        .select()
        .single();

      if (todaErr) {
        console.error('[todaRoutes] /register tutta todaErr:', todaErr);
        throw todaErr;
      }

      // 2. Link toda_admin if auth_user_id or email is provided
      if (todaData && auth_user_id) {
        try {
          await supabase.from('toda_admin').insert([
            {
              auth_user_id,
              toda_id: todaData.toda_id,
              full_name: president_name.trim(),
              email: email ? email.trim() : null,
              contact_number,
              account_status: 'Active',
            },
          ]);
        } catch (adminErr) {
          console.warn('[todaRoutes] /register toda_admin insert notice:', adminErr);
        }
      }

      // 3. Write Audit Log
      try {
        await supabase.from('audit_log').insert([
          {
            action_type: 'TODA_REGISTRATION_SUBMITTED',
            target_id: todaData?.toda_id,
            details: `Submitted new TODA accreditation application for '${toda_name}' in Brgy. ${barangay || 'San Vicente Central'}.`,
            performed_at: new Date().toISOString(),
          },
        ]);
      } catch (auditErr) {
        console.warn('[todaRoutes] Audit log notice:', auditErr);
      }

      return res.json({
        success: true,
        message: 'TODA application submitted successfully.',
        data: todaData,
      });
    }

    return res.json({ success: true, message: 'Local mode: TODA recorded.' });
  } catch (err: any) {
    console.error('[todaRoutes] /register error:', err);
    return res.status(500).json({ success: false, error: err.message || 'Failed to register TODA.' });
  }
});

// ============================================================================
// 4 - 6. APPROVE / RETURN / REJECT / DECLINE A TODA APPLICATION: disabled (Batch 12)
// ============================================================================
// The decision belongs to the database functions approve_toda_accreditation, return_toda_accreditation and deactivate_toda_accreditation (the LGU Administrator is
// checked inside and the audit entry - actor, before, after, reason - is written in the same transaction). These routes took the actor's name from the request body,
// wrote with the service-role key and no actor, and made up a certificate number and expiry, so they answer 403.
router.post('/:id/approve', forbidDirectTodaDecision);
router.post('/:id/return-correction', forbidDirectTodaDecision);
router.post('/:id/reject', forbidDirectTodaDecision);
router.post('/:id/decline', forbidDirectTodaDecision);

export default router;

