import React, { useId, useRef, useState } from 'react';
import { Box, Typography } from '@mui/material';

export interface RegisterInputProps {
  label: string;
  value: string;
  onChange: (val: string) => void;
  type?: string;
  error?: boolean;
  helperText?: string;
  endAdornment?: React.ReactNode;
  isPhone?: boolean;
  onFocus?: () => void;
  onBlur?: () => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  placeholder?: string;
  readOnly?: boolean;
  required?: boolean;
  shake?: boolean;
  multiline?: boolean;
  rows?: number;
}

export const RegisterInput: React.FC<RegisterInputProps> = ({
  label,
  value,
  onChange,
  type = 'text',
  error = false,
  helperText = '',
  endAdornment,
  onFocus,
  onBlur,
  onKeyDown,
  placeholder,
  readOnly = false,
  required = false,
  shake = false,
  multiline = false,
  rows = 3,
}) => {
  const [focused, setFocused] = useState(false);
  const inputId = useId();
  const helpId = `${inputId}-help`;
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const isFloating = focused || Boolean(value && value.length > 0);

  // The whole box is the tap target, not just the line of text inside it.
  const handleBoxClick = (e: React.MouseEvent<HTMLElement>) => {
    if (!readOnly && !(e.target as HTMLElement).closest('button, a, input, textarea, select')) inputRef.current?.focus();
  };

  return (
    <Box sx={{ width: '100%' }}>
      <Box
        className={shake ? 'anim-shake' : ''}
        onClick={handleBoxClick}
        data-error={error ? 'true' : undefined}
        sx={{
          width: '100%',
          minHeight: multiline ? `${rows * 24 + 40}px` : '62px',
          height: multiline ? 'auto' : '62px',
          borderRadius: '16px',
          backgroundColor: focused ? '#FFFFFF' : '#F1F3F5',
          border: `1.5px solid ${error ? '#DC2626' : focused ? '#FF6600' : '#E2E8F0'}`,
          boxShadow: focused
            ? '0 0 0 3px rgba(255, 102, 0, 0.12)'
            : 'none',
          px: 2,
          py: multiline ? 1.25 : 0,
          position: 'relative',
          display: 'flex',
          alignItems: multiline ? 'flex-start' : 'center',
          transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
          boxSizing: 'border-box',
          cursor: 'text',
        }}
      >
        <Typography
          component="label"
          htmlFor={inputId}
          sx={{
            position: 'absolute',
            left: '16px',
            right: endAdornment ? '48px' : '16px',
            top: isFloating ? '8px' : multiline ? '18px' : '50%',
            transform: isFloating ? 'translateY(0)' : multiline ? 'none' : 'translateY(-50%)',
            fontSize: isFloating ? '12px' : '16px',
            fontWeight: isFloating ? 600 : 400,
            color: error ? '#DC2626' : focused ? '#C2410C' : '#64748B',
            userSelect: 'none',
            pointerEvents: 'none',
            whiteSpace: isFloating ? 'normal' : 'nowrap',
            wordBreak: 'break-word',
            lineHeight: 1.15,
            transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
            display: 'flex',
            alignItems: 'center',
            zIndex: 1,
          }}
        >
          {label}
          {required && (
            <Box component="span" sx={{ color: '#DC2626', ml: '3px', fontWeight: 700 }}>
              *
            </Box>
          )}
        </Typography>

        <Box
          sx={{
            width: '100%',
            display: 'flex',
            alignItems: multiline ? 'flex-start' : 'center',
            pt: isFloating ? '18px' : 0,
            pb: isFloating ? '2px' : 0,
          }}
        >
          {multiline ? (
            <textarea
              id={inputId}
              ref={(el) => {
                inputRef.current = el;
              }}
              aria-invalid={error || undefined}
              aria-required={required || undefined}
              aria-describedby={helperText ? helpId : undefined}
              rows={rows}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onFocus={() => {
                setFocused(true);
                if (onFocus) onFocus();
              }}
              onBlur={() => {
                setFocused(false);
                if (onBlur) onBlur();
              }}
              onKeyDown={onKeyDown}
              readOnly={readOnly}
              placeholder={isFloating ? placeholder : ''}
              style={{
                width: '100%',
                border: 'none',
                outline: 'none',
                background: 'transparent',
                fontSize: '16px',
                fontWeight: 600,
                color: '#0F172A',
                fontFamily: 'inherit',
                padding: 0,
                margin: 0,
                resize: 'none',
              }}
            />
          ) : (
            <input
              id={inputId}
              ref={(el) => {
                inputRef.current = el;
              }}
              aria-invalid={error || undefined}
              aria-required={required || undefined}
              aria-describedby={helperText ? helpId : undefined}
              type={type}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onFocus={() => {
                setFocused(true);
                if (onFocus) onFocus();
              }}
              onBlur={() => {
                setFocused(false);
                if (onBlur) onBlur();
              }}
              onKeyDown={onKeyDown}
              readOnly={readOnly}
              placeholder={isFloating ? placeholder : ''}
              style={{
                width: '100%',
                border: 'none',
                outline: 'none',
                background: 'transparent',
                fontSize: '16px',
                fontWeight: 600,
                color: '#0F172A',
                fontFamily: 'inherit',
                padding: 0,
                margin: 0,
              }}
            />
          )}
        </Box>

        {endAdornment && (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              ml: 1,
              flexShrink: 0,
            }}
          >
            {endAdornment}
          </Box>
        )}
      </Box>

      {helperText && (
        <Typography
          id={helpId}
          role={error ? 'alert' : undefined}
          sx={{
            fontSize: '12px',
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

export default RegisterInput;
