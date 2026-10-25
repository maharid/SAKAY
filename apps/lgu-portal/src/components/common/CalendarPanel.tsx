import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Button, IconButton } from '@mui/material';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';

import { FONT } from '../../styles/density';
import { PAGE_BORDER, PAGE_TEXT } from '../../styles/pageTheme';

export interface CalendarPanelProps {
  /** the chosen date (null = none yet) */
  value: Date | null;
  onSelect: (date: Date) => void;
  /** the earliest and the latest date that can be chosen; the days outside are shown but cannot be used */
  min?: Date | null;
  max?: Date | null;
  /** shows a "Clear" button that calls this */
  onClear?: () => void;
  /** shows a "Today" button (default true) */
  showToday?: boolean;
  /** moves the keyboard focus onto the calendar when it appears (a popup that was just opened) */
  autoFocus?: boolean;
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = [
  { short: 'Su', full: 'Sunday' },
  { short: 'Mo', full: 'Monday' },
  { short: 'Tu', full: 'Tuesday' },
  { short: 'We', full: 'Wednesday' },
  { short: 'Th', full: 'Thursday' },
  { short: 'Fr', full: 'Friday' },
  { short: 'Sa', full: 'Saturday' },
];

const BRAND = '#C75000';
const CELL = 36;

export const startOfDay = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
// the same day number in another month (the 31st moves to the last day of a shorter month)
const addMonths = (d: Date, n: number): Date => {
  const target = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  return new Date(target.getFullYear(), target.getMonth(), Math.min(d.getDate(), last));
};
const sameDay = (a: Date | null, b: Date | null): boolean => Boolean(a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate());
const keyOf = (d: Date): string => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
const fullLabel = (d: Date): string => `${WEEKDAYS[d.getDay()].full}, ${MONTH_NAMES[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;

const selectSx = {
  height: 32,
  px: '8px',
  border: `1px solid ${PAGE_BORDER}`,
  borderRadius: '8px',
  backgroundColor: '#FFFFFF',
  color: PAGE_TEXT.primary,
  fontFamily: 'inherit',
  fontSize: FONT.body,
  fontWeight: 600,
  cursor: 'pointer',
  '&:hover': { borderColor: 'var(--sakay-orange-border)' },
  '&:focus-visible': { outline: `2px solid ${BRAND}`, outlineOffset: '1px' },
} as const;

const arrowSx = {
  width: 32,
  height: 32,
  color: PAGE_TEXT.primary,
  border: `1px solid ${PAGE_BORDER}`,
  borderRadius: '8px',
  '&:hover': { backgroundColor: 'var(--sakay-orange-soft)' },
  '&:focus-visible': { outline: `2px solid ${BRAND}`, outlineOffset: '1px' },
  '&.Mui-disabled': { opacity: 0.4 },
} as const;

const footerButtonSx = {
  minHeight: 32,
  px: '12px',
  textTransform: 'none',
  fontSize: FONT.body,
  fontWeight: 700,
  color: '#B34700',
  borderRadius: '8px',
  '&:hover': { backgroundColor: 'var(--sakay-orange-soft)' },
  '&:focus-visible': { outline: `2px solid ${BRAND}`, outlineOffset: '1px' },
  '&.Mui-disabled': { color: '#8A8A90' },
} as const;

/**
 * The month calendar every date field and date popup of the LGU portal uses: a seven-column grid of days (always six rows, so the popup never changes height),
 * with the month and the year to pick from, arrows for the month before and after, and Today / Clear underneath. The chosen day is a filled circle and bold, today
 * has a ring, days that cannot be used are crossed out. It works with the keyboard: Tab goes to the day that has the focus, the arrow keys move by a day or a
 * week, Home and End go to the start and the end of the week, Page Up and Page Down by a month (with Shift by a year), Enter or Space chooses.
 */
export const CalendarPanel: React.FC<CalendarPanelProps> = ({ value, onSelect, min = null, max = null, onClear, showToday = true, autoFocus = false }) => {
  const today = useMemo(() => startOfDay(new Date()), []);
  const lo = min ? startOfDay(min) : null;
  const hi = max ? startOfDay(max) : null;
  const disabled = (d: Date) => Boolean((lo && d < lo) || (hi && d > hi));
  const clamp = (d: Date) => (lo && d < lo ? lo : hi && d > hi ? hi : d);

  // the day that has the focus; the month on show is always its month
  const [focusDate, setFocusDate] = useState<Date>(() => clamp(startOfDay(value ?? today)));
  const wantsFocus = useRef(autoFocus);
  const buttons = useRef(new Map<string, HTMLButtonElement>());

  const year = focusDate.getFullYear();
  const month = focusDate.getMonth();

  useEffect(() => {
    if (!wantsFocus.current) return;
    wantsFocus.current = false;
    buttons.current.get(keyOf(focusDate))?.focus();
  }, [focusDate]);

  const moveTo = (d: Date, moveFocus: boolean) => {
    wantsFocus.current = moveFocus;
    setFocusDate(clamp(d));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const steps: Record<string, Date | undefined> = {
      ArrowLeft: addDays(focusDate, -1),
      ArrowRight: addDays(focusDate, 1),
      ArrowUp: addDays(focusDate, -7),
      ArrowDown: addDays(focusDate, 7),
      Home: addDays(focusDate, -focusDate.getDay()),
      End: addDays(focusDate, 6 - focusDate.getDay()),
      PageUp: addMonths(focusDate, e.shiftKey ? -12 : -1),
      PageDown: addMonths(focusDate, e.shiftKey ? 12 : 1),
    };
    const next = steps[e.key];
    if (!next) return;
    e.preventDefault();
    moveTo(next, true);
  };

  // six weeks starting on the Sunday of the week that holds the 1st
  const first = new Date(year, month, 1);
  const gridStart = addDays(first, -first.getDay());
  const weeks = Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (_, d) => addDays(gridStart, w * 7 + d)));

  const thisYear = today.getFullYear();
  const firstYear = Math.min(lo ? lo.getFullYear() : 1950, year);
  const lastYear = Math.max(hi ? hi.getFullYear() : thisYear + 10, year);
  const years = Array.from({ length: lastYear - firstYear + 1 }, (_, i) => lastYear - i);

  const canGoBack = !lo || addDays(new Date(year, month, 1), -1) >= lo;
  const canGoForward = !hi || new Date(year, month + 1, 1) <= hi;

  return (
    <Box sx={{ width: 7 * CELL + 8, maxWidth: '100%' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px', mb: '10px' }}>
        <IconButton aria-label="Previous month" disabled={!canGoBack} onClick={() => moveTo(addMonths(focusDate, -1), false)} sx={arrowSx}>
          <ChevronLeftIcon sx={{ fontSize: 20 }} />
        </IconButton>
        <Box sx={{ display: 'flex', gap: '6px', flex: 1, minWidth: 0 }}>
          <Box component="select" aria-label="Month" value={month} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => moveTo(new Date(year, Number(e.target.value), Math.min(focusDate.getDate(), new Date(year, Number(e.target.value) + 1, 0).getDate())), false)} sx={{ ...selectSx, flex: 1.4, minWidth: 0 }}>
            {MONTH_NAMES.map((m, i) => (
              <option key={m} value={i}>{m}</option>
            ))}
          </Box>
          <Box component="select" aria-label="Year" value={year} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => moveTo(new Date(Number(e.target.value), month, Math.min(focusDate.getDate(), new Date(Number(e.target.value), month + 1, 0).getDate())), false)} sx={{ ...selectSx, flex: 1, minWidth: 0 }}>
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </Box>
        </Box>
        <IconButton aria-label="Next month" disabled={!canGoForward} onClick={() => moveTo(addMonths(focusDate, 1), false)} sx={arrowSx}>
          <ChevronRightIcon sx={{ fontSize: 20 }} />
        </IconButton>
      </Box>

      <Box role="grid" aria-label={`${MONTH_NAMES[month]} ${year}`} onKeyDown={onKeyDown}>
        <Box role="row" sx={{ display: 'grid', gridTemplateColumns: `repeat(7, ${CELL}px)`, justifyContent: 'center', mb: '4px' }}>
          {WEEKDAYS.map((d) => (
            <Box key={d.full} role="columnheader" aria-label={d.full} sx={{ height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: FONT.small, fontWeight: 700, color: PAGE_TEXT.secondary }}>
              {d.short}
            </Box>
          ))}
        </Box>
        {weeks.map((week) => (
          <Box key={keyOf(week[0])} role="row" sx={{ display: 'grid', gridTemplateColumns: `repeat(7, ${CELL}px)`, justifyContent: 'center' }}>
            {week.map((day) => {
              const inMonth = day.getMonth() === month;
              if (!inMonth) {
                // the days of the month before and after only fill the grid
                return (
                  <Box key={keyOf(day)} role="gridcell" aria-hidden sx={{ height: CELL, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: '#A1A1AA', userSelect: 'none' }}>
                    {day.getDate()}
                  </Box>
                );
              }
              const selected = sameDay(day, value);
              const isToday = sameDay(day, today);
              const off = disabled(day);
              const hasFocus = sameDay(day, focusDate);
              return (
                <Box key={keyOf(day)} role="gridcell" aria-selected={selected} sx={{ height: CELL, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Box
                    component="button"
                    type="button"
                    ref={(node: HTMLButtonElement | null) => {
                      if (node) buttons.current.set(keyOf(day), node);
                      else buttons.current.delete(keyOf(day));
                    }}
                    tabIndex={hasFocus ? 0 : -1}
                    disabled={off}
                    aria-label={`${fullLabel(day)}${isToday ? ', today' : ''}${selected ? ', selected' : ''}${off ? ', not available' : ''}`}
                    aria-current={isToday ? 'date' : undefined}
                    onClick={() => onSelect(day)}
                    onFocus={() => {
                      if (!sameDay(day, focusDate)) setFocusDate(day);
                    }}
                    sx={{
                      width: CELL - 2,
                      height: CELL - 2,
                      p: 0,
                      borderRadius: '50%',
                      fontFamily: 'inherit',
                      fontSize: 13,
                      fontWeight: selected ? 800 : 600,
                      cursor: off ? 'not-allowed' : 'pointer',
                      backgroundColor: selected ? BRAND : 'transparent',
                      color: selected ? '#FFFFFF' : off ? '#A1A1AA' : PAGE_TEXT.primary,
                      // today is a ring, the chosen day is filled and has a second ring around it: neither depends on colour alone
                      border: isToday && !selected ? `2px solid ${BRAND}` : '2px solid transparent',
                      boxShadow: selected ? `0 0 0 2px #FFFFFF, 0 0 0 4px ${BRAND}` : 'none',
                      textDecoration: off ? 'line-through' : 'none',
                      '&:hover:not(:disabled)': { backgroundColor: selected ? '#A84300' : 'var(--sakay-orange-soft)' },
                      '&:focus-visible': { outline: `2px solid ${PAGE_TEXT.primary}`, outlineOffset: '2px' },
                    }}
                  >
                    {day.getDate()}
                  </Box>
                </Box>
              );
            })}
          </Box>
        ))}
      </Box>

      {(showToday || onClear) && (
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: '10px', pt: '8px', borderTop: `1px solid ${PAGE_BORDER}` }}>
          {onClear ? (
            <Button onClick={onClear} sx={footerButtonSx}>
              Clear
            </Button>
          ) : (
            <span />
          )}
          {showToday && (
            <Button onClick={() => onSelect(today)} disabled={disabled(today)} sx={footerButtonSx}>
              Today
            </Button>
          )}
        </Box>
      )}
    </Box>
  );
};
