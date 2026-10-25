import React from 'react';
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material';

import { FONT } from '../../styles/density';
import { PAGE_TEXT, dangerOutlineButtonSx, primaryButtonSx, secondaryButtonSx } from '../../styles/pageTheme';

interface UnsavedChangesDialogProps {
  open: boolean;
  title: string;
  message: string;
  /** The label of the button that saves ("Save as Draft", or "Save Changes" for an announcement that is already published) */
  saveLabel: string;
  /** The save is running */
  busy?: boolean;
  /** What went wrong with the last save (the form stays open and nothing was saved) */
  error?: string | null;
  onSave: () => void;
  onDiscard: () => void;
  onKeepEditing: () => void;
}

// "Do you want to keep what you typed?": three plain choices. Closing the dialog any other way (Escape, a click outside) is the SAFE choice, Keep Editing.
export const UnsavedChangesDialog: React.FC<UnsavedChangesDialogProps> = ({ open, title, message, saveLabel, busy = false, error, onSave, onDiscard, onKeepEditing }) => (
  <Dialog
    open={open}
    onClose={() => !busy && onKeepEditing()}
    slotProps={{
      backdrop: { sx: { backgroundColor: 'rgba(0, 0, 0, 0.45)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' } },
      paper: { sx: { borderRadius: 'var(--mac-radius-lg)', maxWidth: 440, width: '100%', backgroundColor: '#FFFFFF', boxShadow: 'var(--mac-shadow-popover)', overflow: 'hidden', m: '16px' } },
    }}
  >
    <DialogTitle sx={{ padding: '16px 19px 13px', borderBottom: '1px solid var(--mac-border-color)', fontSize: FONT.cardTitle, fontWeight: 600, color: PAGE_TEXT.primary, backgroundColor: '#FAFAFC' }}>
      {title}
    </DialogTitle>
    <DialogContent sx={{ pt: '20px !important', pb: '16px !important', px: '19px !important' }}>
      <Typography sx={{ fontSize: FONT.body, color: PAGE_TEXT.secondary, lineHeight: 1.5 }}>{message}</Typography>
      {error &&<Alert severity="error" sx={{ borderRadius: '10px', mt: '12px' }}>{error}</Alert>}
    </DialogContent>
    <DialogActions sx={{ padding: '13px 19px', borderTop: '1px solid var(--mac-border-color)', backgroundColor: '#FAFAFC', gap: 1.2, flexWrap: 'wrap', '& > :not(style) ~ :not(style)': { ml: 0 } }}>
      <Button onClick={onDiscard} disabled={busy} sx={dangerOutlineButtonSx}>
        Discard Changes
      </Button>
      <Box sx={{ flex: '1 1 0', minWidth: 0 }} />
      <Button onClick={onKeepEditing} disabled={busy} sx={secondaryButtonSx}>
        Keep Editing
      </Button>
      <Button onClick={onSave} disabled={busy} variant="contained" sx={primaryButtonSx}>
        {busy ? 'Saving...' : saveLabel}
      </Button>
    </DialogActions>
  </Dialog>
);
