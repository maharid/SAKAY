import React, { useState } from 'react';
import { Button } from '@mui/material';
import type { AppealSubjectType } from '@sakay/shared';

import { MacConfirmDialog } from './MacConfirmDialog';
import { closeAccountPermanently, voidStrike } from '../../services/adminApiService';

/** What the screen shows afterwards (a toast or snackbar) and then reloads the account from the database. */
export type SanctionResult = (message: string, severity: 'success' | 'error') => void | Promise<void>;

interface VoidStrikeButtonProps {
  strikeId: string;
  onDone: SanctionResult;
}

/**
 * Rule 22 / admin_void_strike: the one way to remove a strike that should never have been issued. It is not the way to forgive a real one (that is an
 * appeal decision, Rule 25). The reason is required and goes to the audit log; the database re-checks who may do it.
 */
export const VoidStrikeButton: React.FC<VoidStrikeButtonProps> = ({ strikeId, onDone }) => {
  const [open, setOpen] = useState(false);

  const confirm = async (reason?: string) => {
    setOpen(false);
    if (!reason) return;
    const problem = await voidStrike(strikeId, reason);
    await onDone(problem ?? 'The strike was voided. The reason is in the audit log.', problem ? 'error' : 'success');
  };

  return (
    <>
      <Button
        size="small"
        color="error"
        variant="text"
        onClick={() => setOpen(true)}
        sx={{ textTransform: 'none', fontSize: '10.4px', fontWeight: 600, minWidth: 0, px: 1, flexShrink: 0 }}
      >
        Void
      </Button>
      <MacConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        title="Void this strike?"
        message="A voided strike is removed from the record as if it had never been issued, and an open appeal of it is closed. Use this only for a strike that should never have been issued. A real strike with a good reason is decided as an appeal."
        confirmLabel="Void strike"
        confirmVariant="danger"
        requireReason
        minReasonLength={5}
        reasonPlaceholder="Why was this strike issued in error?"
        onConfirm={confirm}
      />
    </>
  );
};

interface CloseAccountButtonProps {
  subjectType: AppealSubjectType;
  subjectId: string;
  subjectName: string;
  onDone: SanctionResult;
}

/**
 * Rule 22.2 / admin_close_account: a deactivation does not lift by itself, and after reviewing the whole history the LGU Administrator may Reactivate
 * or Permanently Close. Closing is final: the person can never log in again and cannot appeal. The dialog asks for the history review and a reason.
 */
export const CloseAccountButton: React.FC<CloseAccountButtonProps> = ({ subjectType, subjectId, subjectName, onDone }) => {
  const [open, setOpen] = useState(false);

  const confirm = async (reason?: string) => {
    setOpen(false);
    if (!reason) return;
    // pressing "I reviewed the history" is the confirmation the function asks for
    const problem = await closeAccountPermanently(subjectType, subjectId, reason, true);
    await onDone(problem ?? `${subjectName}'s account was closed permanently.`, problem ? 'error' : 'success');
  };

  return (
    <>
      <Button
        variant="text"
        color="error"
        onClick={() => setOpen(true)}
        sx={{ textTransform: 'none', fontSize: '11.6px', fontWeight: 600, mr: 'auto' }}
      >
        Close account permanently
      </Button>
      <MacConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        title="Close this account permanently?"
        message={`This closes "${subjectName}" for good: the person can never log in again and cannot appeal. Confirm that you reviewed the full violation history shown above. To give the person another chance, reactivate the account instead.`}
        confirmLabel="I reviewed the history - close permanently"
        confirmVariant="danger"
        requireReason
        minReasonLength={10}
        reasonPlaceholder="Why is the account being closed? (at least 10 characters)"
        onConfirm={confirm}
      />
    </>
  );
};
