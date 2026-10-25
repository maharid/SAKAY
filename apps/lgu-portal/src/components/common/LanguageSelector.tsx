import React from 'react';
import { Box, Typography } from '@mui/material';
import { activateWithKeyboard } from '@sakay/shared';

import { useLanguage } from '../../hooks/useLanguage';
import { PAGE_TEXT, pageFocusRing } from '../../styles/pageTheme';
import { CONTROL, FONT } from '../../styles/density';

interface LanguageSelectorProps {
  /** read out by a screen reader for the group, e.g. "Language" */
  label: string;
}

// The language selector of the Driver App's Settings page, in the portal's colours and sizes: two boxes side by side in a grey track, the chosen one filled orange
// with white text. Like there, each box is a radio that is reached with Tab and chosen with a click, Enter or Space. The languages are the two the portal offers
// (utils/language.ts), and a choice is remembered by the portal's LanguageProvider.
export const LanguageSelector: React.FC<LanguageSelectorProps> = ({ label }) => {
  const { language, setLanguage, options } = useLanguage();

  return (
    <Box
      role="radiogroup"
      aria-label={label}
      sx={{ display: 'flex', width: 280, maxWidth: '100%', backgroundColor: '#F1F5F9', borderRadius: '12px', p: '3px', gap: '4px' }}
    >
      {options.map((option) => {
        const selected = option.code === language;
        return (
          <Box
            key={option.code}
            role="radio"
            tabIndex={0}
            aria-checked={selected}
            onKeyDown={activateWithKeyboard}
            onClick={() => setLanguage(option.code)}
            sx={{
              flex: 1,
              minHeight: CONTROL.height + 4,
              '@media (pointer: coarse)': { minHeight: CONTROL.touchHeight },
              borderRadius: '9px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              userSelect: 'none',
              transition: 'all 0.2s ease',
              backgroundColor: selected ? '#C75000' : 'transparent',
              color: selected ? '#FFFFFF' : PAGE_TEXT.secondary,
              boxShadow: selected ? '0 2px 8px rgba(199, 80, 0, 0.25)' : 'none',
              '&:hover': selected ? {} : { backgroundColor: 'rgba(15, 23, 42, 0.05)' },
              ...pageFocusRing,
            }}
          >
            <Typography sx={{ fontSize: FONT.body, fontWeight: selected ? 700 : 500, color: 'inherit' }}>{option.name}</Typography>
          </Box>
        );
      })}
    </Box>
  );
};
