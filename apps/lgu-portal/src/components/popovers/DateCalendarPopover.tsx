import React, { useEffect, useRef } from 'react';
import { Box } from '@mui/material';

import { CalendarPanel } from '../common/CalendarPanel';
import { PAGE_BORDER } from '../../styles/pageTheme';

interface DateCalendarPopoverProps {
  open: boolean;
  onClose: () => void;
  selectedDate: Date;
  onSelectDate: (date: Date) => void;
}

// A calendar that opens under the field it sits in (the parent is positioned): the same calendar as the date fields of the portal (components/common/CalendarPanel).
// A click outside it or Escape closes it.
export const DateCalendarPopover: React.FC<DateCalendarPopoverProps> = ({ open, onClose, selectedDate, onSelectDate }) => {
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) onClose();
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <Box
      ref={popoverRef}
      role="dialog"
      aria-label="Calendar"
      sx={{
        position: 'absolute',
        top: 'calc(100% + 8px)',
        right: 0,
        zIndex: 200,
        maxWidth: 'calc(100vw - 24px)',
        p: '14px',
        borderRadius: '14px',
        border: `1px solid ${PAGE_BORDER}`,
        backgroundColor: '#FFFFFF',
        boxShadow: '0 14px 34px rgba(15, 23, 42, 0.16)',
      }}
    >
      <CalendarPanel
        autoFocus
        value={selectedDate && !Number.isNaN(selectedDate.getTime()) ? selectedDate : null}
        onSelect={(date) => {
          onSelectDate(date);
          onClose();
        }}
        showToday={false}
      />
    </Box>
  );
};
