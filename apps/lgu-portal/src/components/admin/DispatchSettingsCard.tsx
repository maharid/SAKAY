import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Box, Button, TextField, Typography } from '@mui/material';
import { SakayToast } from '@sakay/shared';

import { DashboardCard } from '../dashboard/DashboardCard';
import { fetchDispatchSettings, saveDispatchSetting, type DispatchSettings } from '../../services/adminApiService';
import { FONT } from '../../styles/density';
import { PAGE_DIVIDER, PAGE_TEXT, primaryButtonSx } from '../../styles/pageTheme';

type SettingKey = 'offer_window_seconds' | 'tier3_max_seconds';

const minutesText = (seconds: number): string => {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s === 0 ? `${m} min` : `${m} min ${s} s`;
};

/**
 * ============================================================================
 * DISPATCH SETTINGS (Intelligent Driver Dispatch)
 * ============================================================================
 * The two values the LGU Administrator may change at run time:
 *   - how long a driver has to answer one booking offer (Rule 7.3: 15 seconds in the pilot)
 *   - the longest the search for a driver runs before the booking becomes "No Driver Found"
 * The database holds, range-checks and audits them; the radii, the tiers and the rest of the policy are not editable here.
 * A change applies to offers made and searches that reach that point AFTER it is saved.
 * ============================================================================
 */
export const DispatchSettingsCard: React.FC = () => {
  const [settings, setSettings] = useState<DispatchSettings | null>(null);
  const [offerWindow, setOfferWindow] = useState<string>('');
  const [tier3Max, setTier3Max] = useState<string>('');
  const [busy, setBusy] = useState<SettingKey | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    try {
      const s = await fetchDispatchSettings();
      setSettings(s);
      setOfferWindow(String(s.offerWindowSeconds));
      setTier3Max(String(s.tier3MaxSeconds));
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'The dispatch settings could not be loaded.' });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async (key: SettingKey, raw: string) => {
    const value = Number(raw);
    if (!Number.isInteger(value)) {
      setMessage({ type: 'error', text: 'Enter a whole number of seconds.' });
      return;
    }
    setBusy(key);
    setMessage(null);
    try {
      await saveDispatchSetting(key, value);
      await load();
      setSaved(true);
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'The setting was not saved.' });
    } finally {
      setBusy(null);
    }
  };

  if (!settings) {
    return message ? (
      <Alert severity="warning" sx={{ mb: 2.4 }}>
        {message.text}
      </Alert>
    ) : null;
  }

  const row = (key: SettingKey, label: string, hint: string, value: string, setValue: (v: string) => void, current: number, def: number, limits: [number, number]) => (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: '12px 16px', flexWrap: 'wrap', py: '12px', '&:first-of-type': { pt: 0 }, '&:last-of-type': { pb: 0 } }}>
      <Box sx={{ minWidth: 'min(260px, 100%)', flex: 1 }}>
        <Typography sx={{ fontSize: FONT.body, fontWeight: 600, color: PAGE_TEXT.primary }}>{label}</Typography>
        <Typography sx={{ fontSize: FONT.small, color: PAGE_TEXT.secondary, lineHeight: 1.5 }}>
          {hint} Default {def} s ({minutesText(def)}); allowed {limits[0]} to {limits[1]} s.
        </Typography>
      </Box>
      <TextField
        size="small"
        type="number"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        slotProps={{ htmlInput: { min: limits[0], max: limits[1], step: 1, 'aria-label': label } }}
        sx={{ width: 120 }}
        helperText={`now ${current} s`}
      />
      <Button variant="contained" disabled={busy !== null || Number(value) === current} onClick={() => save(key, value)} sx={primaryButtonSx}>
        {busy === key ? 'Saving...' : 'Save'}
      </Button>
    </Box>
  );

  return (
    <Box sx={{ mb: '19px' }}>
      <DashboardCard title="Driver search" description="How long a driver has to answer an offer, and how long the search for a driver may run. The search radii are fixed by policy.">
        {message && <Alert severity={message.type} sx={{ mb: '10px', borderRadius: '10px' }}>{message.text}</Alert>}
        <SakayToast message={saved ? 'Saved. It applies from the next offer or search that reaches this point.' : null} severity="success" onClose={() => setSaved(false)} />
        <Box sx={{ '& > div + div': { borderTop: `1px solid ${PAGE_DIVIDER}` } }}>
          {row('offer_window_seconds', 'Offer response window', 'How long one driver has to accept or decline an offer.', offerWindow, setOfferWindow,
            settings.offerWindowSeconds, settings.defaults.offerWindowSeconds, settings.limits.offerWindowSeconds)}
          {row('tier3_max_seconds', 'Longest search', 'How long the live search widens before the booking becomes "No Driver Found".', tier3Max, setTier3Max,
            settings.tier3MaxSeconds, settings.defaults.tier3MaxSeconds, settings.limits.tier3MaxSeconds)}
        </Box>
      </DashboardCard>
    </Box>
  );
};

export default DispatchSettingsCard;
