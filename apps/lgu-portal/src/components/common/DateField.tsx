import React, { useEffect, useRef, useState } from 'react';
import { IconButton, InputAdornment, Popover, TextField } from '@mui/material';
import type { SxProps, Theme } from '@mui/material';
import CalendarMonthOutlinedIcon from '@mui/icons-material/CalendarMonthOutlined';

import { CalendarPanel, startOfDay } from './CalendarPanel';
import { PAGE_BORDER } from '../../styles/pageTheme';

interface DateFieldProps {
  label: string;
  /** the date as "YYYY-MM-DD" (what a date input holds), or "" for none */
  value: string;
  onChange: (value: string) => void;
  /** the earliest and the latest date that can be chosen, as "YYYY-MM-DD" */
  min?: string;
  max?: string;
  disabled?: boolean;
  required?: boolean;
  helperText?: React.ReactNode;
  fullWidth?: boolean;
  sx?: SxProps<Theme>;
}

// "2026-10-25" <-> a date in this computer's calendar (no time zone shifts: it is only a day)
const parseIso = (iso: string | undefined): Date | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '');
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]) ? d : null;
};
const toIso = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
// shown as month/day/year, the way the date inputs showed it before
const display = (iso: string): string => {
  const d = parseIso(iso);
  return d ? `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}` : '';
};
const parseTyped = (text: string): Date | null => {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text.trim());
  if (!m) return null;
  const d = new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2]));
  return d.getMonth() === Number(m[1]) - 1 && d.getDate() === Number(m[2]) ? d : null;
};

/**
 * A date field: type the date as mm/dd/yyyy, or press the calendar button and pick it. The value is "YYYY-MM-DD" (or "") exactly as a date input's was, so the pages
 * that use it keep their state and their date rules; `min` and `max` are the only limits. A typed date that is not a real day, or is outside the limits, is not
 * accepted: the field goes back to the date it had and says why.
 */
export const DateField: React.FC<DateFieldProps> = ({ label, value, onChange, min, max, disabled, required, helperText, fullWidth, sx }) => {
  const anchor = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(display(value));
  const [problem, setProblem] = useState<string | null>(null);

  // the date changed from outside (Clear filters, the calendar): show it
  useEffect(() => {
    setText(display(value));
    setProblem(null);
  }, [value]);

  const lo = parseIso(min);
  const hi = parseIso(max);

  const commit = () => {
    const typed = text.trim();
    if (typed === '') {
      setProblem(null);
      if (value !== '') onChange('');
      return;
    }
    const date = parseTyped(typed);
    if (!date) {
      setText(display(value));
      setProblem('Enter a real date as mm/dd/yyyy.');
      return;
    }
    if ((lo && startOfDay(date) < startOfDay(lo)) || (hi && startOfDay(date) > startOfDay(hi))) {
      setText(display(value));
      setProblem(lo && startOfDay(date) < startOfDay(lo) ? `Choose ${display(min ?? '')} or later.` : `Choose ${display(max ?? '')} or earlier.`);
      return;
    }
    setProblem(null);
    setText(display(toIso(date)));
    if (toIso(date) !== value) onChange(toIso(date));
  };

  return (
    <>
      <TextField
        ref={anchor}
        size="small"
        label={label}
        value={text}
        disabled={disabled}
        required={required}
        fullWidth={fullWidth}
        placeholder="mm/dd/yyyy"
        error={Boolean(problem)}
        helperText={problem ?? helperText}
        onChange={(e) => {
          setText(e.target.value.replace(/[^\d/]/g, '').slice(0, 10));
          setProblem(null);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          }
        }}
        slotProps={{
          inputLabel: { shrink: true },
          htmlInput: { inputMode: 'numeric', autoComplete: 'off' },
          formHelperText: problem ? { role: 'alert' } : undefined,
          input: {
            endAdornment: (
              <InputAdornment position="end" sx={{ mr: '-6px' }}>
                <IconButton
                  size="small"
                  aria-label={`Choose a date for ${label}`}
                  aria-haspopup="dialog"
                  aria-expanded={open}
                  disabled={disabled}
                  onClick={() => setOpen(true)}
                  sx={{ color: 'text.secondary', '&:focus-visible': { outline: '2px solid #B34700', outlineOffset: '1px' } }}
                >
                  <CalendarMonthOutlinedIcon sx={{ fontSize: 19 }} />
                </IconButton>
              </InputAdornment>
            ),
          },
        }}
        sx={sx}
      />
      <Popover
        open={open}
        anchorEl={anchor.current}
        onClose={() => setOpen(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{
          paper: {
            role: 'dialog',
            'aria-label': `Calendar for ${label}`,
            sx: { mt: '6px', p: '14px', borderRadius: '14px', border: `1px solid ${PAGE_BORDER}`, boxShadow: '0 14px 34px rgba(15, 23, 42, 0.16)', backgroundColor: '#FFFFFF', maxWidth: 'calc(100vw - 24px)' },
          },
        }}
      >
        <CalendarPanel
          autoFocus
          value={parseIso(value)}
          min={lo}
          max={hi}
          onSelect={(d) => {
            onChange(toIso(d));
            setOpen(false);
          }}
          onClear={
            required || value === ''
              ? undefined
              : () => {
                  onChange('');
                  setOpen(false);
                }
          }
        />
      </Popover>
    </>
  );
};
