import React from 'react';
import { Alert, Box, Button, Typography } from '@mui/material';

import type { TodaChangeRequest } from '../../types/toda';
import { SPACE, FONT } from '../../styles/density';
import { secondaryButtonSx } from './pageButtons';

interface PendingChangesListProps {
  requests: TodaChangeRequest[];
  /** takes the TODA's own pending request back */
  onWithdraw: (requestId: string) => void;
  busyId?: string | null;
}

const FIELD_LABEL: Record<string, string> = {
  toda_name: 'Name',
  toda_acronym: 'Acronym',
  barangay: 'Barangay',
  date_established: 'Date established',
};

const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('en-US', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric' }) : '');
const show = (value: unknown) => (value === null || value === undefined || value === '' ? 'not set' : String(value));

/**
 * The changes an accredited TODA asked for that the LGU has not decided, and the LGU's last refusal. The record in force is what the rest of the page shows;
 * what is written here is only what was asked for. A pending request can be taken back; a decided one is shown once, in the LGU's own words.
 */
export const PendingChangesList: React.FC<PendingChangesListProps> = ({ requests, onWithdraw, busyId }) => {
  const pending = requests.filter((r) => r.status === 'Pending');
  const lastRejected = ['profile', 'bylaws'].map((kind) => requests.find((r) => r.kind === kind && r.status !== 'Pending')).filter((r): r is TodaChangeRequest => Boolean(r && r.status === 'Rejected'));
  if (pending.length === 0 && lastRejected.length === 0) return null;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: SPACE.gap, mt: SPACE.gap }}>
      {pending.map((r) => (
        <Alert
          key={r.requestId}
          severity="warning"
          sx={{ fontSize: FONT.body, alignItems: 'flex-start' }}
          action={
            <Button size="small" onClick={() => onWithdraw(r.requestId)} disabled={busyId === r.requestId} sx={secondaryButtonSx}>
              Take it back
            </Button>
          }
        >
          {r.kind === 'profile' ? (
            <>
              <strong>Change to the TODA details waiting for the LGU</strong> (sent {when(r.requestedAt)}). The details above stay in force until the LGU approves.
              <Box component="ul" sx={{ m: '6px 0 0', pl: '18px' }}>
                {Object.keys(r.proposed).map((key) => (
                  <li key={key}>
                    <Typography component="span" sx={{ fontSize: FONT.body }}>
                      {FIELD_LABEL[key] ?? key}: {show(r.previous[key])} → <strong>{show(r.proposed[key])}</strong>
                    </Typography>
                  </li>
                ))}
              </Box>
              {r.reason && <Box component="span" sx={{ display: 'block', mt: '4px' }}>Your reason: {r.reason}</Box>}
            </>
          ) : (
            <>
              <strong>New Internal Bylaws waiting for the LGU</strong> (sent {when(r.requestedAt)}{r.fileName ? `, "${r.fileName.replace(/^\d{13}_/, '')}"` : ''}). The bylaws in force stay as they are until the LGU approves.
            </>
          )}
        </Alert>
      ))}
      {lastRejected.map((r) => (
        <Alert key={r.requestId} severity="error" sx={{ fontSize: FONT.body }}>
          <strong>The LGU did not approve the {r.kind === 'profile' ? 'change to the TODA details' : 'new Internal Bylaws'}</strong> ({when(r.decidedAt)}). {r.decisionNote}
        </Alert>
      ))}
    </Box>
  );
};
