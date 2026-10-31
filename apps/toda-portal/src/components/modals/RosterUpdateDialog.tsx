import React, { useEffect, useState } from 'react';
import { Alert, Box, Button, Checkbox, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, TextField, Typography } from '@mui/material';

import { DIALOG_ACTIONS_SX, DIALOG_CONTENT_SX, DIALOG_INTRO_SX, DIALOG_PAPER_SX, DIALOG_TITLE_SX } from '@sakay/shared/components/dialogStyles';
import { OPS_TEXT } from '../operations/operationsTheme';
import { primaryButtonSx } from '../common/pageButtons';
import { applyRosterReconciliation, diffRosterFileWithRoster } from '../../services/todaApiService';
import type { RosterFileDiff } from '../../services/todaApiService';
import { SakayDialogTitle } from '@sakay/shared';

interface RosterUpdateDialogProps {
  open: boolean;
  onClose: () => void;
  /** the newer roster file the TODA just submitted (a new VERSION: the registration file is kept as it was) */
  file: { path: string; name: string } | null;
  /** called after members were added or marked as left, so the screens reload */
  onApplied: (summary: string) => void;
}

/**
 * Decision D-P9 (owner's request: "20 in the file, 22 on the roster: what do we do?"). A newer roster file is NEVER copied over the Master Roster. This shows the two lists side by side:
 * members in the file who are not on the roster yet (added unless the TODA unticks them), and active members who are not in the file (kept unless the TODA ticks them as left, with a reason).
 * Nothing changes until "Apply"; closing the dialog leaves the Master Roster exactly as it is.
 */
export const RosterUpdateDialog: React.FC<RosterUpdateDialogProps> = ({ open, onClose, file, onApplied }) => {
  const [diff, setDiff] = useState<RosterFileDiff | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [addKeys, setAddKeys] = useState<Set<string>>(new Set());
  const [leftIds, setLeftIds] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !file) return;
    let stopped = false;
    setDiff(null);
    setLoadError(null);
    setError(null);
    setReason('');
    setLeftIds(new Set());
    diffRosterFileWithRoster(file.path, file.name)
      .then((d) => {
        if (stopped) return;
        setDiff(d);
        setAddKeys(new Set(d.onlyInFile.map((m) => m.franchiseNumber)));
      })
      .catch((err: Error) => !stopped && setLoadError(err.message));
    return () => { stopped = true; };
  }, [open, file]);

  const toggle = (set: Set<string>, key: string, setter: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key); else next.add(key);
    setter(next);
  };

  const apply = async () => {
    if (!diff) return;
    if (leftIds.size > 0 && reason.trim().length < 10) {
      setError('Say why those members are no longer on the roster (at least 10 characters).');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await applyRosterReconciliation({
        add: diff.onlyInFile.filter((m) => addKeys.has(m.franchiseNumber)),
        markLeft: diff.onlyOnRoster.filter((e) => e.entry_id && leftIds.has(e.entry_id)).map((e) => ({ entryId: e.entry_id as string, reason: reason.trim() })),
      });
      if (result.failed.length > 0) {
        setError(result.failed[0]);
        if (result.added + result.left > 0) onApplied(`${result.added} added, ${result.left} marked as left.`);
        return;
      }
      onApplied(`${result.added} member${result.added === 1 ? '' : 's'} added, ${result.left} marked as left.`);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={() => !busy && onClose()} maxWidth="md" fullWidth slotProps={{ paper: { sx: DIALOG_PAPER_SX } }}>
      <SakayDialogTitle onClose={onClose} busy={busy} sx={DIALOG_TITLE_SX}>Update the Master Roster from your new roster file</SakayDialogTitle>
      <DialogContent sx={DIALOG_CONTENT_SX}>
        <Typography sx={DIALOG_INTRO_SX}>
          The file you submitted when you registered stays as it was. This new file ({file?.name}) is kept as a new version. Nothing is added or removed until you press Apply:
          choose which members to add, and which members who are not in the new file have left.
        </Typography>
        {loadError && <Alert severity="error">{loadError}</Alert>}
        {!diff && !loadError && <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}><CircularProgress size={24} aria-label="Reading the file" /></Box>}
        {diff && (
          <>
            <Alert severity="info">
              {diff.rowsInFile} member{diff.rowsInFile === 1 ? '' : 's'} in the file · {diff.inBoth} already on your roster · {diff.onlyInFile.length} new in the file · {diff.onlyOnRoster.length} on your roster but not in the file.
            </Alert>

            <Box>
              <Typography sx={{ fontWeight: 700, mb: '4px' }}>New in the file: add to the Master Roster ({diff.onlyInFile.length})</Typography>
              {diff.onlyInFile.length === 0 && <Typography sx={{ color: OPS_TEXT.secondary, fontSize: 13 }}>Every member of the file is already on your roster.</Typography>}
              <Box sx={{ maxHeight: 190, overflowY: 'auto' }}>
                {diff.onlyInFile.map((m) => (
                  <FormControlLabel
                    key={m.franchiseNumber}
                    sx={{ display: 'flex' }}
                    control={<Checkbox size="small" checked={addKeys.has(m.franchiseNumber)} onChange={() => toggle(addKeys, m.franchiseNumber, setAddKeys)} />}
                    label={`${m.name} · ${m.franchiseNumber}`}
                  />
                ))}
              </Box>
            </Box>

            <Box>
              <Typography sx={{ fontWeight: 700, mb: '4px' }}>On your roster but not in the file: leave as they are, or tick if the member has left ({diff.onlyOnRoster.length})</Typography>
              {diff.onlyOnRoster.length === 0 && <Typography sx={{ color: OPS_TEXT.secondary, fontSize: 13 }}>Every active member of your roster is in the file.</Typography>}
              <Box sx={{ maxHeight: 190, overflowY: 'auto' }}>
                {diff.onlyOnRoster.map((e) => (
                  <FormControlLabel
                    key={e.entry_id}
                    sx={{ display: 'flex' }}
                    control={<Checkbox size="small" checked={Boolean(e.entry_id && leftIds.has(e.entry_id))} onChange={() => e.entry_id && toggle(leftIds, e.entry_id, setLeftIds)} />}
                    label={`${e.member_name} · ${e.franchise_number} (mark as left)`}
                  />
                ))}
              </Box>
              {leftIds.size > 0 && (
                <TextField
                  label="Why are they no longer on the roster?"
                  placeholder="At least 10 characters: left the TODA, transferred, expelled..."
                  value={reason}
                  onChange={(ev) => setReason(ev.target.value)}
                  required
                  fullWidth
                  size="small"
                  sx={{ mt: '8px' }}
                />
              )}
            </Box>
          </>
        )}
        {error && <Alert severity="error">{error}</Alert>}
      </DialogContent>
      <DialogActions sx={DIALOG_ACTIONS_SX}>
        <Button onClick={onClose} disabled={busy} sx={{ textTransform: 'none', color: OPS_TEXT.secondary, fontWeight: 600 }}>
          Keep my roster as it is
        </Button>
        <Button onClick={apply} variant="contained" disabled={busy || !diff} sx={primaryButtonSx}>
          {busy ? 'Applying...' : 'Apply'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
