import React, { useEffect, useState } from 'react';
import { Box, Button, Dialog, DialogActions, DialogContent, TextField, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { SakayDialogTitle, closeProblem, isAvailabilityFlag } from '@sakay/shared';

import { FlagTag } from '../common/DataTable';
import { DashboardCard } from './DashboardCard';
import { fetchAdminReviewFlags, resolveAdminReviewFlag, confirmDeliberateOffline, confirmFlaggedViolation, confirmIntegrityFlag, sendConductWarning, closeUnfinishedTrip, confirmAvailabilityViolation } from '../../services/adminApiService';
import { INTEGRITY_FLAG_TYPES, describeFlagDetails, isOpenFlag } from '../../utils/reviewFlagDetails';
import { flagTypeLabel } from '../../utils/flagTypeLabel';
import { FONT } from '../../styles/density';
import { PAGE_DIVIDER, PAGE_TEXT, dangerButtonSx, primaryButtonSx, rowActionSx, secondaryButtonSx } from '../../styles/pageTheme';

interface ReviewFlagsPanelProps {
  /** Show at most this many of the flags waiting (the Dashboard shows five); the rest are on the Review Flags page, reached by "See more" */
  limit?: number;
  /** The page that lists every flag (the "See more" button goes there) */
  seeMoreTo?: string;
  /** Which flags are listed: the ones waiting for an administrator, or the ones already resolved */
  view?: 'open' | 'resolved';
  /** Say so when nothing is waiting (the full page does; the Dashboard shows nothing at all, so a quiet day has no empty card) */
  showWhenEmpty?: boolean;
}

/**
 * The administrative review flags (Rules 2.4, 2.5, 3.7 and the detectors of the later batches): the ones waiting for an administrator, each with the button that opens its own
 * resolution window. The Dashboard shows the first five and a "See more" button when there are more; the Review Flags page shows them all. Resolving a flag is the same window,
 * the same database functions and the same audit entries wherever it is opened from.
 */
export const ReviewFlagsPanel: React.FC<ReviewFlagsPanelProps> = ({ limit, seeMoreTo = '/review-flags', view = 'open', showWhenEmpty = false }) => {
  const [adminFlags, setAdminFlags] = useState<any[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [selectedFlag, setSelectedFlag] = useState<any | null>(null);
  const [flagResolutionText, setFlagResolutionText] = useState('');
  const [flagDialogOpen, setFlagDialogOpen] = useState(false);
  const [flagError, setFlagError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    fetchAdminReviewFlags()
      .then((flags) => {
        if (isMounted) setAdminFlags(flags || []);
      })
      .catch((err) => {
        console.warn('[ReviewFlagsPanel] Failed to fetch admin flags:', err);
        if (isMounted) setLoadFailed(true);
      })
      .finally(() => {
        if (isMounted) setLoaded(true);
      });
    return () => {
      isMounted = false;
    };
  }, []);

  const handleResolveFlag = async () => {
    if (!selectedFlag) return;
    try {
      await resolveAdminReviewFlag(selectedFlag.flag_id, flagResolutionText || 'Resolved by LGU Administrator');
      setAdminFlags((prev) =>
        prev.map((f) =>
          f.flag_id === selectedFlag.flag_id
            ? { ...f, status: 'Resolved', resolution: flagResolutionText || 'Resolved' }
            : f
        )
      );
      setFlagDialogOpen(false);
      setSelectedFlag(null);
      setFlagResolutionText('');
    } catch (err) {
      console.error('[ReviewFlagsPanel] Flag resolve error:', err);
    }
  };

  // Rule 9.6: the LGU Administrator confirms the TODA Administrator's report of a deliberate offline: 2 strikes
  const handleConfirmDeliberateOffline = async () => {
    if (!selectedFlag) return;
    const message = await confirmDeliberateOffline(selectedFlag.flag_id, flagResolutionText);
    if (message) {
      setFlagError(message);
      return;
    }
    setAdminFlags((prev) => prev.map((f) => (f.flag_id === selectedFlag.flag_id ? { ...f, status: 'Resolved', resolution: 'Confirmed: 2 strikes' } : f)));
    setFlagDialogOpen(false);
    setSelectedFlag(null);
    setFlagResolutionText('');
    setFlagError(null);
  };

  // Rules 27.1, 27.3 - 27.6: confirm what a detector flag points at
  const handleConfirmIntegrity = async () => {
    if (!selectedFlag) return;
    const message = await confirmIntegrityFlag(selectedFlag.flag_id, flagResolutionText);
    if (message) {
      setFlagError(message);
      return;
    }
    setAdminFlags((prev) => prev.map((f) => (f.flag_id === selectedFlag.flag_id ? { ...f, status: 'Resolved', resolution: 'Violation confirmed' } : f)));
    setFlagDialogOpen(false);
    setSelectedFlag(null);
    setFlagResolutionText('');
    setFlagError(null);
  };

  // Rules 5.3 / 5.7: the LGU Administrator confirms a reported queue conflict or availability violation: the strike is recorded under their name
  const handleConfirmAvailability = async () => {
    if (!selectedFlag) return;
    const message = await confirmAvailabilityViolation(selectedFlag.flag_id, flagResolutionText);
    if (message) {
      setFlagError(message);
      return;
    }
    setAdminFlags((prev) => prev.map((f) => (f.flag_id === selectedFlag.flag_id ? { ...f, status: 'Resolved', resolution: 'Violation confirmed' } : f)));
    setFlagDialogOpen(false);
    setSelectedFlag(null);
    setFlagResolutionText('');
    setFlagError(null);
  };

  // PI-15: a trip left at the destination (Payment Received never tapped) is closed as Paid or Waived after the parties were contacted; this also resolves the flag
  const handleCloseStuckTrip = async (paymentStatus: 'Paid' | 'Waived') => {
    if (!selectedFlag) return;
    const bookingId = selectedFlag.details?.booking_id;
    if (typeof bookingId !== 'string') {
      setFlagError('This flag does not name a trip.');
      return;
    }
    const message = await closeUnfinishedTrip(bookingId, paymentStatus, flagResolutionText);
    if (message) {
      setFlagError(message);
      return;
    }
    setAdminFlags((prev) => prev.map((f) => (f.flag_id === selectedFlag.flag_id ? { ...f, status: 'Resolved', resolution: `Trip closed as ${paymentStatus}` } : f)));
    setFlagDialogOpen(false);
    setSelectedFlag(null);
    setFlagResolutionText('');
    setFlagError(null);
  };

  // Rule 23.4: a passenger whose average stayed under 3.00 after 20 trips may get a warning
  const handleSendWarning = async () => {
    if (!selectedFlag) return;
    const message = await sendConductWarning(selectedFlag.flag_id, flagResolutionText);
    if (message) {
      setFlagError(message);
      return;
    }
    setAdminFlags((prev) => prev.map((f) => (f.flag_id === selectedFlag.flag_id ? { ...f, status: 'Resolved', resolution: 'Warning sent' } : f)));
    setFlagDialogOpen(false);
    setSelectedFlag(null);
    setFlagResolutionText('');
    setFlagError(null);
  };

  // Rules 13.6 / 13.7: the LGU Administrator confirms the strike a review flag points at
  const handleConfirmViolation = async () => {
    if (!selectedFlag) return;
    const message = await confirmFlaggedViolation(selectedFlag.flag_id, selectedFlag.details?.booking_id ?? null, flagResolutionText);
    if (message) {
      setFlagError(message);
      return;
    }
    setAdminFlags((prev) => prev.map((f) => (f.flag_id === selectedFlag.flag_id ? { ...f, status: 'Resolved', resolution: 'Violation confirmed' } : f)));
    setFlagDialogOpen(false);
    setSelectedFlag(null);
    setFlagResolutionText('');
    setFlagError(null);
  };

  const waiting = adminFlags.filter(isOpenFlag);
  const listed = view === 'open' ? waiting : adminFlags.filter((f) => !isOpenFlag(f));
  const shown = limit ? listed.slice(0, limit) : listed;
  const hidden = listed.length - shown.length;

  if (listed.length === 0 && !showWhenEmpty) return <>{null}</>;

  return (
    <Box sx={limit ? { mb: '19px' } : undefined}>
      <DashboardCard
        title={view === 'open' ? 'Review flags' : 'Resolved review flags'}
        description={view === 'open' ? "Items that need an administrator's decision." : 'Flags an administrator has already decided.'}
        titleAdornment={listed.length > 0 ? <FlagTag label={view === 'open' ? `${listed.length} pending` : `${listed.length} resolved`} tone={view === 'open' ? 'warning' : 'neutral'} /> : undefined}
      >
        {listed.length === 0 ? (
          <Typography role="status" sx={{ fontSize: FONT.body, color: PAGE_TEXT.secondary, py: '8px' }}>
            {!loaded ? 'Loading review flags...' : loadFailed ? 'The review flags could not be loaded. Refresh the page to try again.' : view === 'open' ? 'No review flags are waiting for a decision.' : 'No flag has been resolved yet.'}
          </Typography>
        ) : (
          <Box component="ul" sx={{ m: 0, p: 0, listStyle: 'none', '& > li + li': { borderTop: `1px solid ${PAGE_DIVIDER}` } }}>
            {shown.map((flag) => (
              <Box component="li" key={flag.flag_id} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px 12px', py: '10px' }}>
                <Box sx={{ minWidth: 0 }}>
                  <Typography sx={{ fontSize: FONT.body, fontWeight: 600, color: PAGE_TEXT.primary }}>{flagTypeLabel(flag.flag_type)}</Typography>
                  <Typography sx={{ fontSize: FONT.small, color: PAGE_TEXT.secondary, mt: '1px', overflowWrap: 'anywhere' }}>
                    {flag.subject_type}: <Box component="span" sx={{ fontFamily: 'monospace' }}>{flag.subject_id}</Box>
                    {' · '}
                    {new Date(flag.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </Typography>
                  {view === 'resolved' && flag.resolution && (
                    <Typography sx={{ fontSize: FONT.small, color: PAGE_TEXT.secondary, mt: '1px', overflowWrap: 'anywhere' }}>Resolution: {String(flag.resolution)}</Typography>
                  )}
                </Box>
                {view === 'open' && (
                  <Button
                    aria-label={`Resolve flag: ${flagTypeLabel(flag.flag_type)}`}
                    onClick={() => {
                      setSelectedFlag(flag);
                      setFlagDialogOpen(true);
                    }}
                    sx={rowActionSx('brand')}
                  >
                    Resolve flag
                  </Button>
                )}
              </Box>
            ))}
          </Box>
        )}
        {hidden > 0 && (
          <Box sx={{ display: 'flex', justifyContent: 'center', pt: '12px', mt: '4px', borderTop: `1px solid ${PAGE_DIVIDER}` }}>
            <Button component={RouterLink} to={seeMoreTo} aria-label={`See more: ${hidden} more review flag${hidden === 1 ? '' : 's'}`} sx={rowActionSx('neutral')}>
              See more ({hidden} more)
            </Button>
          </Box>
        )}
      </DashboardCard>

      {/* Flag Resolution Dialog */}
      <Dialog open={flagDialogOpen} onClose={() => setFlagDialogOpen(false)} maxWidth="sm" fullWidth>
        <SakayDialogTitle onClose={() => setFlagDialogOpen(false)} sx={{ fontWeight: 700, fontSize: FONT.cardTitle, color: PAGE_TEXT.primary }}>
          Resolve flag: {flagTypeLabel(selectedFlag?.flag_type)}
        </SakayDialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: FONT.body, color: PAGE_TEXT.secondary, mb: 1.6 }}>
            Provide resolution notes for {selectedFlag?.subject_type} {selectedFlag?.subject_id} ({selectedFlag?.source_rule}).
          </Typography>
          {describeFlagDetails(selectedFlag).length > 0 && (
            <Box sx={{ mb: 1.6, p: 1.2, borderRadius: '8px', backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0' }}>
              {describeFlagDetails(selectedFlag).map((line, i) => (
                <Typography key={i} sx={{ fontSize: FONT.body, color: PAGE_TEXT.primary, lineHeight: 1.5 }}>
                  {line}
                </Typography>
              ))}
            </Box>
          )}
          {flagError && (
            <Typography role="alert" sx={{ fontSize: FONT.body, color: PAGE_TEXT.danger, mb: 1.2 }}>{flagError}</Typography>
          )}
          <TextField
            autoFocus
            fullWidth
            multiline
            rows={3}
            label="Resolution notes"
            value={flagResolutionText}
            onChange={(e) => setFlagResolutionText(e.target.value)}
            placeholder="e.g. Verified with manual certificate, franchise validated, or inspection completed..."
          />
        </DialogContent>
        <DialogActions sx={{ p: 1.6, flexWrap: 'wrap', gap: 1, '& > :not(style) ~ :not(style)': { ml: 0 } }}>
          <Button onClick={() => { setFlagDialogOpen(false); setFlagError(null); }} sx={secondaryButtonSx}>
            Cancel
          </Button>
          {selectedFlag?.flag_type === 'DRIVER_DELIBERATE_OFFLINE_REPORT' && (
            <Button
              onClick={handleConfirmDeliberateOffline}
              variant="contained"
              disabled={!flagResolutionText.trim()}
              sx={dangerButtonSx}
            >
              Confirm: 2 strikes
            </Button>
          )}
          {(selectedFlag?.flag_type === 'PASSENGER_EARLY_END_PATTERN' || (selectedFlag?.flag_type === 'DRIVER_EARLY_STOP_REVIEW' && selectedFlag?.details?.valid_reason === false)) && (
            <Button
              onClick={handleConfirmViolation}
              variant="contained"
              disabled={flagResolutionText.trim().length < 10}
              sx={dangerButtonSx}
            >
              Confirm: 1 strike
            </Button>
          )}
          {INTEGRITY_FLAG_TYPES.includes(selectedFlag?.flag_type) && (
            <Button
              onClick={handleConfirmIntegrity}
              variant="contained"
              disabled={flagResolutionText.trim().length < 10}
              sx={dangerButtonSx}
            >
              Confirm the violation
            </Button>
          )}
          {isAvailabilityFlag(selectedFlag?.flag_type ?? '') && (
            <Button
              onClick={handleConfirmAvailability}
              variant="contained"
              disabled={flagResolutionText.trim().length < 10}
              sx={dangerButtonSx}
            >
              Confirm: record the strike
            </Button>
          )}
          {selectedFlag?.flag_type === 'PAYMENT_STUCK_RECONCILIATION' && (
            <>
              <Button
                onClick={() => handleCloseStuckTrip('Paid')}
                variant="contained"
                disabled={closeProblem('Paid', flagResolutionText) !== null}
                sx={primaryButtonSx}
              >
                Close the trip: Paid
              </Button>
              <Button
                onClick={() => handleCloseStuckTrip('Waived')}
                variant="outlined"
                disabled={closeProblem('Waived', flagResolutionText) !== null}
                sx={secondaryButtonSx}
              >
                Close the trip: Waived
              </Button>
            </>
          )}
          {selectedFlag?.flag_type === 'PASSENGER_LOW_RATING_REVIEW' && (
            <Button
              onClick={handleSendWarning}
              variant="contained"
              disabled={flagResolutionText.trim().length < 10}
              sx={primaryButtonSx}
            >
              Send the passenger a warning
            </Button>
          )}
          <Button onClick={handleResolveFlag} variant="contained" sx={primaryButtonSx}>
            Mark as resolved
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};
