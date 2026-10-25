import React, { useState, useEffect } from 'react';
import { Box, Typography } from '@mui/material';

import { FONT } from '../../styles/density';

export interface SakayPhoneInputProps {
  label?: string;
  value: string;
  onChange: (fullNumber: string) => void;
  error?: boolean;
  helperText?: string;
  required?: boolean;
  readOnly?: boolean;
  /** the compact scale of the signed-in portal (a 40px field, 12px text); off by default, so the registration flow keeps its roomier look */
  compact?: boolean;
}

export const extract9DigitsAfter9 = (raw: string): string => {
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  let after9 = '';
  if (digits.startsWith('639')) {
    after9 = digits.slice(3);
  } else if (digits.startsWith('09')) {
    after9 = digits.slice(2);
  } else if (digits.startsWith('9')) {
    after9 = digits.slice(1);
  } else {
    after9 = digits;
  }
  return after9.slice(0, 9);
};

export const SakayPhoneInput: React.FC<SakayPhoneInputProps> = ({
  label = 'Contact Number',
  value,
  onChange,
  error = false,
  helperText = '',
  required = false,
  readOnly = false,
  compact = false,
}) => {
  const [focused, setFocused] = useState(false);
  const [digitsAfter9, setDigitsAfter9] = useState(() => extract9DigitsAfter9(value));

  useEffect(() => {
    setDigitsAfter9(extract9DigitsAfter9(value));
  }, [value]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (readOnly) return;
    const val = e.target.value;
    const cleanDigits = extract9DigitsAfter9(val);
    setDigitsAfter9(cleanDigits);
    const fullNational = cleanDigits ? `09${cleanDigits}` : '';
    onChange(fullNational);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const start = input.selectionStart ?? 0;
    const end = input.selectionEnd ?? 0;

    if (e.key === 'Backspace') {
      if (start === end && start <= 1) {
        e.preventDefault();
        return;
      }
    }
    if (e.key === 'Delete') {
      if (start === end && start === 0) {
        e.preventDefault();
        return;
      }
    }
  };

  const displayInputValue = `9${digitsAfter9}`;

  return (
    <Box sx={{ width: '100%' }}>
      <Box
        sx={{
          width: '100%',
          minHeight: compact ? '40px' : '62px',
          height: compact ? '40px' : '62px',
          borderRadius: compact ? '10px' : '16px',
          backgroundColor: focused ? '#FFFFFF' : '#F1F3F5',
          border: `1.5px solid ${error ? '#DC2626' : focused ? '#FF6600' : '#E2E8F0'}`,
          boxShadow: focused ? '0 0 0 3px rgba(255, 102, 0, 0.12)' : 'none',
          px: compact ? '12px' : 2,
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
          boxSizing: 'border-box',
          cursor: 'text',
        }}
      >
        <Typography
          sx={{
            position: 'absolute',
            left: compact ? '12px' : '16px',
            right: compact ? '12px' : '16px',
            top: compact ? '3px' : '8px',
            transform: 'translateY(0)',
            fontSize: compact ? FONT.caption : '9.5px',
            fontWeight: 700,
            color: error ? '#DC2626' : focused ? '#FF6600' : '#64748B',
            letterSpacing: '0.5px',
            textTransform: 'uppercase',
            userSelect: 'none',
            pointerEvents: 'none',
            lineHeight: 1.15,
            transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
          }}
        >
          {label}
          {required && (
            <Box component="span" sx={{ color: '#FF6600', fontWeight: 800 }}>
              *
            </Box>
          )}
        </Typography>

        <Box
          sx={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            pt: compact ? '14px' : '18px',
            pb: compact ? 0 : '2px',
          }}
        >
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              mr: 1,
              userSelect: 'none',
              pointerEvents: 'none',
              flexShrink: 0,
            }}
          >
            <Typography sx={{ fontSize: compact ? FONT.body : '15px', fontWeight: 700, color: '#0F172A' }}>
              +63
            </Typography>
            <Box
              sx={{
                width: '1.5px',
                height: compact ? '14px' : '18px',
                backgroundColor: '#CBD5E1',
                mx: 1.2,
              }}
            />
          </Box>

          <input
            type="tel"
            value={displayInputValue}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            readOnly={readOnly}
            style={{
              width: '100%',
              border: 'none',
              outline: 'none',
              background: 'transparent',
              fontSize: compact ? '12px' : '15px',
              fontWeight: 600,
              color: '#0F172A',
              fontFamily: 'inherit',
              padding: 0,
              margin: 0,
              letterSpacing: '0.5px',
            }}
          />
        </Box>
      </Box>

      {helperText && (
        <Typography
          sx={{
            fontSize: compact ? FONT.caption : '11.5px',
            color: error ? '#DC2626' : '#64748B',
            fontWeight: error ? 600 : 400,
            mt: '4px',
            ml: '12px',
          }}
        >
          {helperText}
        </Typography>
      )}
    </Box>
  );
};

export default SakayPhoneInput;
