import React from 'react';
import Box from '@mui/material/Box';
import Collapse from '@mui/material/Collapse';
import Paper from '@mui/material/Paper';
import useMediaQuery from '@mui/material/useMediaQuery';
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded';
import KeyboardArrowUpRoundedIcon from '@mui/icons-material/KeyboardArrowUpRounded';

import { useSheetHandle } from '../hooks/useSheetHandle';

export interface CollapsibleSheetProps {
  expanded: boolean;
  /** Only the person changes this (the handle: a tap, a drag, the arrow keys): a trip update never opens or closes the sheet */
  onExpandedChange: (expanded: boolean) => void;
  /** Always shown, right under the handle: who the trip is with, and anything that cannot wait (a timer, a warning). A screen keeps it short: the long explanations belong to the open sheet. */
  summary: React.ReactNode;
  /** Shown only while the sheet is open */
  details?: React.ReactNode;
  /** Always shown at the bottom, pinned: the action for this stage */
  actions?: React.ReactNode;
  /** The handle's accessible names */
  expandLabel: string;
  collapseLabel: string;
  /** Attach the screen's size measurer here: the map keeps its controls and framing clear of the sheet */
  sheetRef?: React.Ref<HTMLDivElement>;
  zIndex?: number;
  /** The tallest the sheet may be (a CSS length): what is above it (a header, a status pill) stays clear. Default: the screen less 96px. */
  maxHeight?: string;
}

/**
 * The bottom card of the trip screens, drawn the way map-first navigation apps draw theirs: a handle, a compact summary that is always there, the pinned action
 * of the stage, and a details section that opens and closes. Closed, it leaves most of the screen to the map; open, it shows everything. Dragging the handle down
 * closes it, dragging up opens it, a tap toggles it, and Arrow Up / Arrow Down do the same for the keyboard. Only the handle takes part in the gesture, so scrolling
 * the details never moves the sheet. The sheet opens and closes only when the person asks (the state belongs to the screen and nothing resets it).
 *
 * The summary and the details are ONE scrolling area between the handle and the actions: when they are taller than the room the sheet has, that area scrolls and
 * the actions stay where they are, so nothing is drawn over the actions and nothing is cut off at the bottom of the screen.
 */
export const CollapsibleSheet: React.FC<CollapsibleSheetProps> = ({ expanded, onExpandedChange, summary, details, actions, expandLabel, collapseLabel, sheetRef, zIndex = 30, maxHeight }) => {
  const { dragY, dragging, handleProps } = useSheetHandle(expanded, onExpandedChange);
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const hasDetails = details !== undefined && details !== null && details !== false;

  return (
    <Paper
      ref={sheetRef}
      elevation={8}
      sx={{
        // the sheet floats over the map, which fills the whole screen behind it (the screen measures the sheet and tells the map what it covers)
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex,
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: '#FFFFFF',
        borderTopLeftRadius: '24px',
        borderTopRightRadius: '24px',
        borderTop: '1px solid #E2E8F0',
        boxShadow: '0 -8px 30px rgba(0, 0, 0, 0.08)',
        maxHeight: maxHeight ?? 'calc(100% - 96px)',
        overflow: 'hidden',
        // only a downward drag moves the sheet with the finger; it settles back when the finger lets go
        transform: dragY > 0 ? `translateY(${dragY}px)` : 'none',
        transition: dragging || reduceMotion ? 'none' : 'transform 0.2s ease',
      }}
    >
      {/* the handle: a wide, tall tap target with a small pill drawn in it, and an arrow at the end that says what a tap does */}
      <Box
        component="button"
        type="button"
        aria-label={expanded ? collapseLabel : expandLabel}
        title={expanded ? collapseLabel : expandLabel}
        {...handleProps}
        sx={{
          position: 'relative',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          height: 32,
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
        {hasDetails && (
          <Box aria-hidden sx={{ position: 'absolute', right: 14, top: 4, width: 24, height: 24, borderRadius: '50%', backgroundColor: '#F1F5F9', color: '#475569', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {expanded ? <KeyboardArrowDownRoundedIcon sx={{ fontSize: 20 }} /> : <KeyboardArrowUpRoundedIcon sx={{ fontSize: 20 }} />}
          </Box>
        )}
      </Box>

      {/* the summary and, while the sheet is open, the details: one area that scrolls when it is taller than the room */}
      <Box className="hide-scrollbar" sx={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain' }}>
        <Box sx={{ px: 2.5, pb: 1 }}>{summary}</Box>
        {hasDetails && (
          <Collapse in={expanded} timeout={reduceMotion ? 0 : 'auto'} unmountOnExit>
            <Box sx={{ px: 2.5, pb: 1.25, display: 'flex', flexDirection: 'column', gap: 1.25 }}>{details}</Box>
          </Collapse>
        )}
      </Box>

      {actions && (
        <Box sx={{ flexShrink: 0, px: 2.5, pt: 1.25, pb: 'calc(var(--safe-area-bottom) + 14px)', borderTop: '1px solid #F1F5F9', display: 'flex', flexDirection: 'column', gap: 1 }}>
          {actions}
        </Box>
      )}
    </Paper>
  );
};

export default CollapsibleSheet;
