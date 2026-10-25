import React from 'react';
import Box from '@mui/material/Box';
import Collapse from '@mui/material/Collapse';
import Paper from '@mui/material/Paper';
import useMediaQuery from '@mui/material/useMediaQuery';

import { useSheetHandle } from '../hooks/useSheetHandle';

export interface CollapsibleSheetProps {
  expanded: boolean;
  /** Only the person changes this (the handle: a tap, a drag, the arrow keys): a trip update never opens or closes the sheet */
  onExpandedChange: (expanded: boolean) => void;
  /** Always shown, right under the handle: who the trip is with, and anything that cannot wait (a timer, a warning) */
  summary: React.ReactNode;
  /** Shown only while the sheet is open; it scrolls when it is tall */
  details?: React.ReactNode;
  /** Always shown at the bottom, pinned: the action for this stage */
  actions?: React.ReactNode;
  /** The handle's accessible names */
  expandLabel: string;
  collapseLabel: string;
  /** Attach the screen's size measurer here: the map keeps its controls and framing clear of the sheet */
  sheetRef?: React.Ref<HTMLDivElement>;
  zIndex?: number;
  /** false (default): the sheet floats over the map at the bottom edge. true: it is a row of the screen's column, below the map, and takes its share of the height. */
  inFlow?: boolean;
}

const DETAILS_MAX_HEIGHT = 'min(44vh, 360px)';

/**
 * The bottom card of the trip screens, drawn the way map-first navigation apps draw theirs: a handle, a compact summary that is always there, the pinned action
 * of the stage, and a details section that opens and closes. Closed, it leaves most of the screen to the map; open, it shows everything. Dragging the handle down
 * closes it, dragging up opens it, a tap toggles it, and Arrow Up / Arrow Down do the same for the keyboard. Only the handle takes part in the gesture, so scrolling
 * the details never moves the sheet. The sheet opens and closes only when the person asks (the state belongs to the screen and nothing resets it).
 */
export const CollapsibleSheet: React.FC<CollapsibleSheetProps> = ({ expanded, onExpandedChange, summary, details, actions, expandLabel, collapseLabel, sheetRef, zIndex = 30, inFlow = false }) => {
  const { dragY, dragging, handleProps } = useSheetHandle(expanded, onExpandedChange);
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const hasDetails = details !== undefined && details !== null && details !== false;

  return (
    <Paper
      ref={sheetRef}
      elevation={8}
      sx={{
        ...(inFlow ? { position: 'relative', width: '100%', flexShrink: 0 } : { position: 'absolute', bottom: 0, left: 0, right: 0 }),
        zIndex,
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: '#FFFFFF',
        borderTopLeftRadius: '24px',
        borderTopRightRadius: '24px',
        borderTop: '1px solid #E2E8F0',
        boxShadow: '0 -8px 30px rgba(0, 0, 0, 0.08)',
        maxHeight: inFlow ? 'min(calc(100% - 176px), 66%)' : 'calc(100% - 96px)',
        overflow: 'hidden',
        // only a downward drag moves the sheet with the finger; it settles back when the finger lets go
        transform: dragY > 0 ? `translateY(${dragY}px)` : 'none',
        transition: dragging || reduceMotion ? 'none' : 'transform 0.2s ease',
      }}
    >
      {/* the handle: a wide, tall tap target with a small pill drawn in it */}
      <Box
        component="button"
        type="button"
        aria-label={expanded ? collapseLabel : expandLabel}
        title={expanded ? collapseLabel : expandLabel}
        {...handleProps}
        sx={{
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          height: 28,
          p: 0,
          border: 0,
          backgroundColor: 'transparent',
          cursor: 'grab',
          touchAction: 'none',
          WebkitTapHighlightColor: 'transparent',
          '&:focus-visible': { outline: '3px solid #0F172A', outlineOffset: -3, borderRadius: '24px 24px 0 0' },
        }}
      >
        <Box aria-hidden sx={{ width: 40, height: 5, borderRadius: 3, backgroundColor: '#CBD5E1' }} />
      </Box>

      <Box sx={{ flexShrink: 0, px: 2.5, pb: 1 }}>{summary}</Box>

      {hasDetails && (
        <Collapse in={expanded} timeout={reduceMotion ? 0 : 'auto'} unmountOnExit sx={{ flexShrink: 1, minHeight: 0 }}>
          <Box className="hide-scrollbar" sx={{ px: 2.5, pb: 1.25, maxHeight: DETAILS_MAX_HEIGHT, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1.25 }}>
            {details}
          </Box>
        </Collapse>
      )}

      {actions && (
        <Box sx={{ flexShrink: 0, px: 2.5, pt: 1.25, pb: 'calc(var(--safe-area-bottom) + 14px)', borderTop: '1px solid #F1F5F9', display: 'flex', flexDirection: 'column', gap: 1 }}>
          {actions}
        </Box>
      )}
    </Paper>
  );
};

export default CollapsibleSheet;
