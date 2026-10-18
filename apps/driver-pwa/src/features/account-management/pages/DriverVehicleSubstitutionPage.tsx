import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Box, Button, Chip, CircularProgress, MenuItem, Paper, TextField, Typography } from '@mui/material';
import {
  SUBSTITUTION_MAX_DAYS,
  asSubstitutionClient,
  endVehicleSubstitution,
  fetchVehicleSubstitutions,
  isOpenSubstitution,
  requestVehicleSubstitution,
  substitutionRequestProblem,
  useInFlight,
  withdrawVehicleSubstitution,
} from '@sakay/shared';
import type { VehicleSubstitution } from '@sakay/shared';

import PageHeader from '../../../common/components/PageHeader';
import PrimaryButton from '../../../common/components/PrimaryButton';
import SakayToast from '../../../common/components/SakayToast';
import { supabase } from '../../../services/supabaseClient';
import { useLanguage } from '../../../utils/LanguageContext';

const manila = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '-';

const STATUS: Record<string, { en: string; tl: string; color: 'warning' | 'success' | 'default' | 'error' }> = {
  'Pending TODA Approval': { en: 'Waiting for your TODA Administrator', tl: 'Naghihintay sa TODA Administrator mo', color: 'warning' },
  'Pending LGU Approval': { en: 'Waiting for the LGU Administrator', tl: 'Naghihintay sa LGU Administrator', color: 'warning' },
  Active: { en: 'Approved: you may use it', tl: 'Aprubado: puwede mo nang gamitin', color: 'success' },
  Ended: { en: 'Ended', tl: 'Natapos na', color: 'default' },
  Denied: { en: 'Not approved', tl: 'Hindi inaprubahan', color: 'error' },
  Withdrawn: { en: 'Withdrawn', tl: 'Binawi', color: 'default' },
};

/**
 * Rule 29.18: asking to use another vehicle. Only the TODA Administrator and then the LGU Administrator can approve it, for 1 to 7 days; until it says "Approved"
 * the other vehicle must NOT be used. While it is approved the plate shown to passengers is the substitute's, and the registered vehicle comes back by itself.
 */
const DriverVehicleSubstitutionPage: React.FC = () => {
  const navigate = useNavigate();
  const { language } = useLanguage();
  const tl = language === 'tl';
  const flight = useInFlight();

  const [rows, setRows] = useState<VehicleSubstitution[] | null>(null);
  const [registeredPlate, setRegisteredPlate] = useState<string | null>(null);
  const [plate, setPlate] = useState('');
  const [franchise, setFranchise] = useState('');
  const [days, setDays] = useState(3);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [list, own] = await Promise.all([
      fetchVehicleSubstitutions(asSubstitutionClient(supabase)),
      supabase.from('driver').select('plate_number').maybeSingle(),
    ]);
    setRows(list);
    setRegisteredPlate(own.data?.plate_number ? String(own.data.plate_number) : null);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const open = rows?.find((r) => isOpenSubstitution(r.status)) ?? null;
  const history = (rows ?? []).filter((r) => !isOpenSubstitution(r.status)).slice(0, 5);
  // while one is active the registered vehicle is not the plate in the driver's record: the check is against the one he registered
  const registered = open?.status === 'Active' ? open.originalPlate : registeredPlate;
  const problem = substitutionRequestProblem({ plate, franchise, reason, days, registeredPlate: registered });

  const send = () =>
    flight.run(async () => {
      if (problem) return;
      const message = await requestVehicleSubstitution(asSubstitutionClient(supabase), plate, franchise, reason, days);
      if (message) {
        setError(message);
        return;
      }
      setError(null);
      setPlate('');
      setFranchise('');
      setReason('');
      setToast(tl ? 'Naipadala ang hiling sa TODA Administrator mo.' : 'Your request was sent to your TODA Administrator.');
      await load();
    });

  const act = (task: () => Promise<string | null>, ok: string) =>
    flight.run(async () => {
      const message = await task();
      if (message) {
        setError(message);
        return;
      }
      setError(null);
      setToast(ok);
      await load();
    });

  return (
    <Box sx={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', backgroundColor: '#F8FAFC' }}>
      <SakayToast message={toast} severity="success" onClose={() => setToast(null)} />
      <PageHeader title={tl ? 'Ibang Sasakyan' : 'Another Vehicle'} onBack={() => navigate(-1)} />
      <Box className="hide-scrollbar" sx={{ flex: 1, overflowY: 'auto', p: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        <Alert severity="info" sx={{ borderRadius: '12px' }}>
          {tl
            ? `Bawal gumamit ng ibang sasakyan nang walang pag-apruba ng TODA Administrator at ng LGU Administrator. Aprubahan muna bago gamitin; hanggang ${SUBSTITUTION_MAX_DAYS} araw lang. Kusang babalik ang rehistrado mong sasakyan pagkatapos.`
            : `You may not use another vehicle without the approval of your TODA Administrator and then the LGU Administrator. Wait for the approval before you use it; up to ${SUBSTITUTION_MAX_DAYS} days. Your registered vehicle comes back by itself afterwards.`}
        </Alert>

        {rows === null ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}><CircularProgress size={28} sx={{ color: '#FF6600' }} /></Box>
        ) : open ? (
          <Paper elevation={0} sx={{ p: 2, borderRadius: '16px', border: '1px solid #F1F5F9', display: 'flex', flexDirection: 'column', gap: 0.75 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1 }}>
              <Typography sx={{ fontSize: '15px', fontWeight: 700, color: '#0F172A' }}>{open.substitutePlate}</Typography>
              <Chip size="small" color={STATUS[open.status].color} label={tl ? STATUS[open.status].tl : STATUS[open.status].en} sx={{ fontWeight: 700 }} />
            </Box>
            <Typography sx={{ fontSize: '12.5px', color: '#64748B' }}>
              {tl ? 'Franchise' : 'Franchise'} {open.substituteFranchise} · {open.requestedDays} {tl ? 'araw' : open.requestedDays === 1 ? 'day' : 'days'}
            </Typography>
            <Typography sx={{ fontSize: '13px', color: '#334155', lineHeight: 1.45 }}>{open.reason}</Typography>
            {open.status === 'Active' && (
              <Typography sx={{ fontSize: '13px', color: '#166534', fontWeight: 600 }}>
                {tl ? `Puwede hanggang ${manila(open.endsAt)}. Kusang babalik ang ${open.originalPlate ?? 'rehistradong sasakyan'}.` : `Valid until ${manila(open.endsAt)}. ${open.originalPlate ?? 'Your registered vehicle'} comes back by itself.`}
              </Typography>
            )}
            {open.status === 'Pending LGU Approval' && open.todaNote && <Typography sx={{ fontSize: '12.5px', color: '#475569' }}>TODA: {open.todaNote}</Typography>}
            {error && <Alert severity="warning" sx={{ borderRadius: '10px', fontSize: '12px' }}>{error}</Alert>}
            {open.status === 'Active' ? (
              <Button variant="outlined" color="error" disabled={flight.busy} onClick={() => act(() => endVehicleSubstitution(asSubstitutionClient(supabase), open.substitutionId, ''), tl ? 'Naibalik na ang rehistradong sasakyan.' : 'Your registered vehicle is back.')} sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '12px', minHeight: 44, alignSelf: 'flex-start' }}>
                {tl ? 'Ibalik na ang rehistradong sasakyan' : 'Go back to my registered vehicle'}
              </Button>
            ) : (
              <Button variant="outlined" disabled={flight.busy} onClick={() => act(() => withdrawVehicleSubstitution(asSubstitutionClient(supabase), open.substitutionId), tl ? 'Binawi ang hiling.' : 'The request was withdrawn.')} sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '12px', minHeight: 44, alignSelf: 'flex-start' }}>
                {tl ? 'Bawiin ang hiling' : 'Withdraw the request'}
              </Button>
            )}
          </Paper>
        ) : (
          <Paper elevation={0} sx={{ p: 2, borderRadius: '16px', border: '1px solid #F1F5F9', display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            <Typography sx={{ fontSize: '14px', fontWeight: 700, color: '#0F172A' }}>{tl ? 'Humiling na gumamit ng ibang sasakyan' : 'Ask to use another vehicle'}</Typography>
            <TextField size="small" label={tl ? 'Plate number ng sasakyan' : 'Plate number of the vehicle'} value={plate} onChange={(e) => setPlate(e.target.value)} fullWidth />
            <TextField size="small" label={tl ? 'Franchise (MTOP) number nito' : 'Its franchise (MTOP) number'} value={franchise} onChange={(e) => setFranchise(e.target.value)} fullWidth />
            <TextField select size="small" label={tl ? 'Ilang araw' : 'For how many days'} value={days} onChange={(e) => setDays(Number(e.target.value))} fullWidth>
              {Array.from({ length: SUBSTITUTION_MAX_DAYS }, (_, i) => i + 1).map((n) => <MenuItem key={n} value={n}>{n}</MenuItem>)}
            </TextField>
            <TextField multiline minRows={3} size="small" label={tl ? 'Bakit mo kailangan? (halimbawa: nasira ang tricycle ko)' : 'Why do you need it? (for example: my tricycle broke down)'} value={reason} onChange={(e) => setReason(e.target.value)} fullWidth />
            {error && <Alert severity="warning" sx={{ borderRadius: '10px', fontSize: '12px' }}>{error}</Alert>}
            <PrimaryButton fullWidth loading={flight.busy} disabled={Boolean(problem)} onClick={send}>
              {tl ? 'Ipadala ang hiling' : 'Send the request'}
            </PrimaryButton>
          </Paper>
        )}

        {history.length > 0 && (
          <>
            <Typography sx={{ fontSize: '12px', fontWeight: 700, color: '#64748B', px: 0.5, mt: 1 }}>{tl ? 'Mga nakaraan' : 'Earlier'}</Typography>
            {history.map((h) => (
              <Paper key={h.substitutionId} elevation={0} sx={{ p: 1.5, borderRadius: '14px', border: '1px solid #F1F5F9' }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1 }}>
                  <Typography sx={{ fontSize: '13px', fontWeight: 600, color: '#0F172A' }}>{h.substitutePlate}</Typography>
                  <Chip size="small" color={STATUS[h.status].color} label={tl ? STATUS[h.status].tl : STATUS[h.status].en} />
                </Box>
                {h.status === 'Denied' && h.denialReason && <Typography sx={{ fontSize: '12px', color: '#B91C1C', mt: 0.5 }}>{h.denialReason}</Typography>}
              </Paper>
            ))}
          </>
        )}
      </Box>
    </Box>
  );
};

export default DriverVehicleSubstitutionPage;
