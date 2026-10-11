import React, { useId, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

export interface FloatingLabelInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  /** autocomplete token ("email", "username", "current-password"): password managers and autofill depend on it */
  autoComplete?: string;
  name?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  required?: boolean;
  error?: boolean;
  /** Shown under the box (and announced): a validation message */
  helperText?: string;
  /** Something at the right end of the box (the show / hide password button) */
  endAdornment?: React.ReactNode;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  /** Brand colour of the focus ring and the floated label (the Passenger / Driver apps' orange by default) */
  accent?: string;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}

const AUTOFILL_ANIMATION = 'sakay-autofill-start';

/**
 * The floating-label field of the Passenger and Driver apps (RegisterInput), for the places that cannot import those apps' files (the two
 * administrator portals). Empty and not focused, the label sits inside the box as the placeholder; on focus, or once there is a value, it
 * moves to the top of the box and stays readable. The whole box is the tap target; the label is a real <label> for the input.
 *
 * Browser autofill can fill the box without a key press or a change event, which would leave the label printed over the filled text: the
 * field notices the autofill (the :-webkit-autofill animation) and floats the label and reports the value.
 */
export const FloatingLabelInput: React.FC<FloatingLabelInputProps> = ({
  label,
  value,
  onChange,
  type = 'text',
  autoComplete,
  name,
  autoFocus,
  disabled = false,
  required = false,
  error = false,
  helperText = '',
  endAdornment,
  inputMode,
  accent = '#FF6B00',
  onKeyDown,
}) => {
  const [focused, setFocused] = useState(false);
  const [autofilled, setAutofilled] = useState(false);
  const inputId = useId();
  const helpId = `${inputId}-help`;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const isFloating = focused || autofilled || value.length > 0;

  return (
    <Box sx={{ width: '100%' }}>
      <Box
        onClick={(e) => {
          if (!disabled && !(e.target as HTMLElement).closest('button, a, input')) inputRef.current?.focus();
        }}
        data-error={error ? 'true' : undefined}
        sx={{
          width: '100%',
          height: 62,
          boxSizing: 'border-box',
          px: 2,
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          borderRadius: '14px',
          backgroundColor: disabled ? '#F5F5F7' : focused ? '#FFFFFF' : '#F5F5F7',
          border: `1.5px solid ${error ? '#D92D20' : focused ? accent : '#E5E5EA'}`,
          boxShadow: focused ? `0 0 0 3px ${accent}1F` : 'none',
          opacity: disabled ? 0.7 : 1,
          cursor: disabled ? 'default' : 'text',
          transition: 'border-color 0.2s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.2s cubic-bezier(0.4, 0, 0.2, 1), background-color 0.2s',
          '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
        }}
      >
        <Typography
          component="label"
          htmlFor={inputId}
          sx={{
            position: 'absolute',
            left: 16,
            right: endAdornment ? 52 : 16,
            top: isFloating ? 8 : '50%',
            transform: isFloating ? 'translateY(0)' : 'translateY(-50%)',
            fontSize: isFloating ? 12 : 15,
            fontWeight: isFloating ? 600 : 400,
            lineHeight: 1.2,
            color: error ? '#B42318' : focused ? '#FF6600' : '#6B6B70',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            pointerEvents: 'none',
            userSelect: 'none',
            transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
            '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
          }}
        >
          {label}
          {required && (
            <Box component="span" aria-hidden sx={{ color: '#D92D20', ml: '3px', fontWeight: 700 }}>
              *
            </Box>
          )}
        </Typography>

        <Box
          component="input"
          id={inputId}
          ref={inputRef}
          name={name}
          type={type}
          value={value}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          disabled={disabled}
          required={required}
          inputMode={inputMode}
          aria-invalid={error || undefined}
          aria-describedby={helperText ? helpId : undefined}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={onKeyDown}
          onAnimationStart={(e: React.AnimationEvent<HTMLInputElement>) => {
            if (e.animationName === AUTOFILL_ANIMATION) {
              setAutofilled(true);
              if (inputRef.current && inputRef.current.value !== value) onChange(inputRef.current.value);
            }
          }}
          sx={{
            flex: 1,
            minWidth: 0,
            height: '100%',
            pt: isFloating ? '20px' : 0,
            pb: isFloating ? '2px' : 0,
            border: 'none',
            outline: 'none',
            background: 'transparent',
            font: 'inherit',
            fontSize: 15,
            fontWeight: 500,
            color: '#1D1D1F',
            '&:disabled': { cursor: 'default' },
            [`@keyframes ${AUTOFILL_ANIMATION}`]: { from: {}, to: {} },
            '&:-webkit-autofill': { animationName: AUTOFILL_ANIMATION, WebkitTextFillColor: '#1D1D1F', transition: 'background-color 600000s 0s' },
          }}
        />
        {endAdornment && <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0, ml: 0.5 }}>{endAdornment}</Box>}
      </Box>
      {helperText && (
        <Typography id={helpId} role={error ? 'alert' : undefined} sx={{ mt: 0.5, mx: 0.5, fontSize: 12, color: error ? '#B42318' : '#6B6B70' }}>
          {helperText}
        </Typography>
      )}
    </Box>
  );
};

export default FloatingLabelInput;
