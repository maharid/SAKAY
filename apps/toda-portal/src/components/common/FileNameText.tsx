import React from 'react';
import { Box } from '@mui/material';

import { FONT } from '../../styles/density';
import { OPS_TEXT } from '../operations/operationsTheme';
import { MacTooltip } from './MacTooltip';

interface FileNameTextProps {
  name: string;
}

/** How many characters at the end of the name always stay visible: the last part of the name and its extension (.pdf, .csv). */
const KEPT_AT_END = 12;

// A file name on ONE line. When it is too long for its space, the middle is replaced by "…" so the beginning and the end (the extension) can still be read,
// and the whole name is in a tooltip that also opens from the keyboard (the name can be focused with Tab).
export const FileNameText: React.FC<FileNameTextProps> = ({ name }) => {
  const tailLength = Math.min(KEPT_AT_END, name.length);
  const head = name.slice(0, name.length - tailLength);
  const tail = name.slice(name.length - tailLength);
  return (
    <MacTooltip title={name} placement="top-start" enterTouchDelay={0}>
      <Box
        tabIndex={0}
        sx={{
          display: 'flex',
          minWidth: 0,
          maxWidth: '100%',
          fontSize: FONT.small,
          fontWeight: 600,
          color: OPS_TEXT.primary,
          borderRadius: '4px',
          '&:focus-visible': { outline: `2px solid ${OPS_TEXT.brand}`, outlineOffset: '2px' },
        }}
      >
        {head && <Box component="span" sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{head}</Box>}
        <Box component="span" sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}>{tail}</Box>
      </Box>
    </MacTooltip>
  );
};
