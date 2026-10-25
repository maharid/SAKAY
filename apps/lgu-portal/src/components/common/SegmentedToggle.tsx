import React from 'react';
import { ToggleButton, ToggleButtonGroup } from '@mui/material';

import { CONTROL, FONT } from '../../styles/density';
import { PAGE_BORDER, PAGE_TEXT } from '../../styles/pageTheme';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedToggleProps<T extends string> {
  /** Read out by a screen reader for the group, e.g. "Show trends by" */
  label: string;
  value: T;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
}

// A small group of choices where exactly one is on (Day / Week / Month). The chosen one is filled with a soft orange and has a darker text, so it is clear
// without relying on colour alone (the chosen one is also announced as "pressed"). The group keeps its own height, like the other page controls.
export function SegmentedToggle<T extends string>({ label, value, options, onChange }: SegmentedToggleProps<T>) {
  return (
    <ToggleButtonGroup
      exclusive
      size="small"
      value={value}
      aria-label={label}
      onChange={(_, next: T | null) => next && onChange(next)}
      sx={{
        backgroundColor: '#FFFFFF',
        '& .MuiToggleButton-root': {
          minHeight: 32,
          px: '12px',
          textTransform: 'none',
          fontSize: FONT.body,
          fontWeight: 600,
          color: PAGE_TEXT.primary,
          border: `1px solid ${PAGE_BORDER}`,
          '@media (pointer: coarse)': { minHeight: CONTROL.touchHeight },
          '&:hover': { backgroundColor: 'var(--sakay-orange-soft)' },
          '&:focus-visible': { outline: `2px solid ${PAGE_TEXT.brand}`, outlineOffset: '2px', zIndex: 1 },
          '&.Mui-selected, &.Mui-selected:hover': { color: PAGE_TEXT.brand, backgroundColor: '#FFF1E4', borderColor: 'var(--sakay-orange-border)', fontWeight: 700 },
        },
      }}
    >
      {options.map((o) => (
        <ToggleButton key={o.value} value={o.value}>
          {o.label}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}
