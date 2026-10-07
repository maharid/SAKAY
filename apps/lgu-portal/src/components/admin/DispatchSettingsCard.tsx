import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Box, Button, Card, CardContent, TextField, Typography } from '@mui/material';
import TuneIcon from '@mui/icons-material/Tune';

import { fetchDispatchSettings, saveDispatchSetting, type DispatchSettings } from '../../services/adminApiService';

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
      setMessage({ type: 'success', text: 'Saved. It applies from the next offer or search that reaches this point.' });
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'The setting was not saved.' });
    } finally {
      setBusy(null);
    }
  };

  if (!settings) {
    return message ? (
      <Alert severity="warning" sx={{ mb: 3 }}>
        {message.text}
      </Alert>
    ) : null;
  }

  const row = (key: SettingKey, label: string, hint: string, value: string, setValue: (v: string) => void, current: number, def: number, limits: [number, number]) => (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2, flexWrap: 'wrap' }}>
      <Box sx={{ minWidth: 260, flex: 1 }}>
        <Typography sx={{ fontSize: '13px', fontWeight: 600, color: 'var(--mac-text-primary)' }}>{label}</Typography>
        <Typography sx={{ fontSize: '11px', color: 'var(--mac-text-muted)' }}>
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
      <Button
        variant="contained"
        disabled={busy !== null || Number(value) === current}
        onClick={() => save(key, value)}
        sx={{ textTransform: 'none', fontWeight: 700, backgroundColor: 'var(--sakay-orange)', '&:hover': { backgroundColor: '#E04B00' } }}
      >
        {busy === key ? 'Saving...' : 'Save'}
      </Button>
    </Box>
  );

  return (
    <Card sx={{ borderRadius: 'var(--mac-radius-lg)', border: '1px solid var(--mac-border-color)', boxShadow: 'var(--mac-shadow-card)', backgroundColor: '#FFFFFF', mb: 3.5 }}>
      <CardContent sx={{ p: '20px 22px !important', display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <TuneIcon sx={{ color: 'var(--sakay-orange)', fontSize: 18 }} />
          <Typography sx={{ fontSize: '13px', fontWeight: 700, color: 'var(--mac-text-primary)' }}>Driver Search Settings</Typography>
        </Box>
        {message && <Alert severity={message.type}>{message.text}</Alert>}
        {row('offer_window_seconds', 'Offer response window', 'How long one driver has to accept or decline an offer (Rule 7.3).', offerWindow, setOfferWindow,
          settings.offerWindowSeconds, settings.defaults.offerWindowSeconds, settings.limits.offerWindowSeconds)}
        {row('tier3_max_seconds', 'Longest search', 'How long the live search widens before the booking becomes "No Driver Found".', tier3Max, setTier3Max,
          settings.tier3MaxSeconds, settings.defaults.tier3MaxSeconds, settings.limits.tier3MaxSeconds)}
      </CardContent>
    </Card>
  );
};

export default DispatchSettingsCard;
