import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Box, Typography, IconButton, TextField, Button } from '@mui/material';
import ColorizeIcon from '@mui/icons-material/Colorize';
import AddIcon from '@mui/icons-material/Add';

import { CONTROL, FONT } from '../../styles/density';

// Helper HSV <-> HEX Conversion Utilities
function hexToHsv(hexStr: string): { h: number; s: number; v: number } {
  let c = hexStr.replace('#', '').trim();
  if (c.length === 3) c = c.split('').map(x => x + x).join('');
  const num = parseInt(c, 16);
  if (isNaN(num) || (c.length !== 6)) return { h: 25, s: 100, v: 100 };
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;

  const rNorm = r / 255, gNorm = g / 255, bNorm = b / 255;
  const max = Math.max(rNorm, gNorm, bNorm), min = Math.min(rNorm, gNorm, bNorm);
  const d = max - min;
  let h = 0;
  const s = max === 0 ? 0 : d / max;
  const v = max;

  if (max !== min) {
    switch (max) {
      case rNorm: h = (gNorm - bNorm) / d + (gNorm < bNorm ? 6 : 0); break;
      case gNorm: h = (bNorm - rNorm) / d + 2; break;
      case bNorm: h = (rNorm - gNorm) / d + 4; break;
    }
    h /= 6;
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), v: Math.round(v * 100) };
}

function hsvToHex(h: number, s: number, v: number): string {
  const sNorm = Math.max(0, Math.min(100, s)) / 100;
  const vNorm = Math.max(0, Math.min(100, v)) / 100;
  const c = vNorm * sNorm;
  const hNorm = (h % 360 + 360) % 360;
  const x = c * (1 - Math.abs(((hNorm / 60) % 2) - 1));
  const m = vNorm - c;
  let r = 0, g = 0, b = 0;

  if (0 <= hNorm && hNorm < 60) { r = c; g = x; b = 0; }
  else if (60 <= hNorm && hNorm < 120) { r = x; g = c; b = 0; }
  else if (120 <= hNorm && hNorm < 180) { r = 0; g = c; b = x; }
  else if (180 <= hNorm && hNorm < 240) { r = 0; g = x; b = c; }
  else if (240 <= hNorm && hNorm < 300) { r = x; g = 0; b = c; }
  else if (300 <= hNorm && hNorm <= 360) { r = c; g = 0; b = x; }

  const rHex = Math.round((r + m) * 255).toString(16).padStart(2, '0');
  const gHex = Math.round((g + m) * 255).toString(16).padStart(2, '0');
  const bHex = Math.round((b + m) * 255).toString(16).padStart(2, '0');

  return `#${rHex}${gHex}${bHex}`.toUpperCase();
}

const DEFAULT_SAVED_SWATCHES = [
  '#059669', // Emerald Green
  '#2563EB', // Municipal Blue
  '#4F46E5', // Indigo
  '#7C3AED', // Royal Violet
  '#C026D3', // Magenta
  '#E11D48', // Crimson
  '#FF6600', // SAKAY Orange
  '#7F56D9', // Purple
];

// Embedded Compact Hex-Only Color Picker Component (No Alpha / No Format Dropdown)
interface EmbeddedColorPickerProps {
  color: string;
  onChange: (hex: string) => void;
}

export const EmbeddedColorPicker: React.FC<EmbeddedColorPickerProps> = ({ color, onChange }) => {
  const [hsv, setHsv] = useState(() => hexToHsv(color));
  const [hexInput, setHexInput] = useState(color);
  const [savedSwatches, setSavedSwatches] = useState<string[]>(DEFAULT_SAVED_SWATCHES);

  const canvasRef = useRef<HTMLDivElement>(null);
  const isDraggingCanvas = useRef(false);

  useEffect(() => {
    const newHsv = hexToHsv(color);
    setHsv(newHsv);
    setHexInput(color.toUpperCase());
  }, [color]);

  const updateColorFromHsv = useCallback((h: number, s: number, v: number) => {
    const newHsv = { h, s, v };
    setHsv(newHsv);
    const hex = hsvToHex(h, s, v);
    setHexInput(hex);
    onChange(hex);
  }, [onChange]);

  // Handle Dragging inside 2D Saturation / Value canvas
  const handleCanvasMove = useCallback((e: MouseEvent | TouchEvent | React.MouseEvent | React.TouchEvent) => {
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

    const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, clientY - rect.top));

    const s = Math.round((x / rect.width) * 100);
    const v = Math.round((1 - y / rect.height) * 100);

    updateColorFromHsv(hsv.h, s, v);
  }, [hsv.h, updateColorFromHsv]);

  const handleCanvasMouseDown = (e: React.MouseEvent | React.TouchEvent) => {
    isDraggingCanvas.current = true;
    handleCanvasMove(e);
  };

  useEffect(() => {
    const handleMouseUp = () => { isDraggingCanvas.current = false; };
    const handleMouseMove = (e: MouseEvent) => {
      if (isDraggingCanvas.current) handleCanvasMove(e);
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleCanvasMove]);

  // Eyedropper integration
  const handleEyeDropper = async () => {
    if ('EyeDropper' in window) {
      try {
        const eyeDropper = new (window as any).EyeDropper();
        const result = await eyeDropper.open();
        if (result.sRGBHex) {
          const hex = result.sRGBHex.toUpperCase();
          onChange(hex);
        }
      } catch (e) {
        // User canceled eyedropper
      }
    }
  };

  const handleAddSavedSwatch = () => {
    const currentHex = hsvToHex(hsv.h, hsv.s, hsv.v);
    if (!savedSwatches.includes(currentHex)) {
      setSavedSwatches([...savedSwatches, currentHex]);
    }
  };

  const pureHueColor = `hsl(${hsv.h}, 100%, 50%)`;
  const pointerLeft = `${hsv.s}%`;
  const pointerTop = `${100 - hsv.v}%`;
  const currentColorHex = hsvToHex(hsv.h, hsv.s, hsv.v);

  return (
    <Box
      sx={{
        width: '100%',
        maxWidth: 380,
        backgroundColor: '#FFFFFF',
        borderRadius: '16px',
        border: '1px solid var(--mac-border-color)',
        boxShadow: '0 4px 20px rgba(0,0,0,0.06)',
        padding: '13px',
        display: 'flex',
        flexDirection: 'column',
        gap: 1.6,
        userSelect: 'none',
      }}
    >
      {/* 1. 2D Saturation / Brightness Gradient Canvas */}
      <Box
        ref={canvasRef}
        onMouseDown={handleCanvasMouseDown}
        onTouchStart={handleCanvasMouseDown}
        sx={{
          width: '100%',
          height: 170,
          borderRadius: '12px',
          position: 'relative',
          cursor: 'crosshair',
          backgroundColor: pureHueColor,
          backgroundImage: `
            linear-gradient(to top, #000000, transparent),
            linear-gradient(to right, #FFFFFF, transparent)
          `,
          overflow: 'hidden',
          boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.08)',
        }}
      >
        {/* Pointer Circle Handle */}
        <Box
          sx={{
            position: 'absolute',
            left: pointerLeft,
            top: pointerTop,
            width: 18,
            height: 18,
            borderRadius: '50%',
            border: '2.5px solid #FFFFFF',
            boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
            backgroundColor: currentColorHex,
            transform: 'translate(-50%, -50%)',
            pointerEvents: 'none',
            transition: isDraggingCanvas.current ? 'none' : 'all 0.05s ease',
          }}
        />
      </Box>

      {/* 2. Controls Row: Eyedropper + Hue Slider Bar */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2 }}>
        {/* Eyedropper Button */}
        <IconButton
          size="small"
          onClick={handleEyeDropper}
          sx={{
            width: 36,
            height: 36,
            borderRadius: '10px',
            border: '1px solid var(--mac-border-color)',
            backgroundColor: '#FFFFFF',
            color: 'var(--mac-text-secondary)',
            flexShrink: 0,
            '&:hover': { backgroundColor: 'var(--mac-canvas-bg)' },
          }}
        >
          <ColorizeIcon fontSize="small" sx={{ fontSize: 14 }} />
        </IconButton>

        {/* Hue Rainbow Slider Bar */}
        <Box
          sx={{
            flexGrow: 1,
            height: 14,
            borderRadius: '7px',
            background: 'linear-gradient(to right, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%)',
            position: 'relative',
            cursor: 'pointer',
          }}
        >
          <input
            type="range"
            min="0"
            max="360"
            value={hsv.h}
            onChange={(e) => updateColorFromHsv(Number(e.target.value), hsv.s, hsv.v)}
            style={{
              width: '100%',
              height: '100%',
              opacity: 0,
              cursor: 'pointer',
              margin: 0,
            }}
          />
          <Box
            sx={{
              position: 'absolute',
              left: `${(hsv.h / 360) * 100}%`,
              top: '50%',
              transform: 'translate(-50%, -50%)',
              width: 16,
              height: 16,
              borderRadius: '50%',
              backgroundColor: pureHueColor,
              border: '2px solid #FFFFFF',
              boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
              pointerEvents: 'none',
            }}
          />
        </Box>
      </Box>

      {/* 3. HEX Format Input (Strictly HEX Only, No Alpha) */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8 }}>
        <Box
          sx={{
            px: 1.2,
            py: 0.8,
            borderRadius: '8px',
            backgroundColor: '#F5F5F7',
            border: '1px solid var(--mac-border-color)',
            fontSize: FONT.caption,
            fontWeight: 700,
            color: 'var(--mac-text-secondary)',
          }}
        >
          HEX
        </Box>

        <Box sx={{ flexGrow: 1, display: 'flex', alignItems: 'center', position: 'relative' }}>
          <Box
            sx={{
              width: 18,
              height: 18,
              borderRadius: '50%',
              backgroundColor: currentColorHex,
              position: 'absolute',
              left: 10,
              zIndex: 2,
              border: '1px solid rgba(0,0,0,0.12)',
            }}
          />
          <TextField
            size="small"
            value={hexInput}
            onChange={(e) => {
              const val = e.target.value.toUpperCase();
              setHexInput(val);
              if (/^#[0-9A-F]{6}$/i.test(val)) {
                const newHsv = hexToHsv(val);
                setHsv(newHsv);
                onChange(val);
              }
            }}
            sx={{
              width: '100%',
              '& .MuiOutlinedInput-root': {
                height: 36,
                '@media (pointer: coarse)': { height: CONTROL.touchHeight },
                borderRadius: '9px',
                pl: 4.2,
                fontSize: FONT.body,
                fontFamily: 'monospace',
                fontWeight: 600,
              },
            }}
          />
        </Box>
      </Box>

      {/* 4. Saved Swatches Row */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.8, pt: 0.4 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography sx={{ fontSize: FONT.caption, fontWeight: 600, color: 'var(--mac-text-primary)' }}>
            Saved Swatches
          </Typography>
          <Button
            size="small"
            startIcon={<AddIcon fontSize="small" sx={{ fontSize: 13 }} />}
            onClick={handleAddSavedSwatch}
            sx={{
              fontSize: FONT.small,
              fontWeight: 600,
              textTransform: 'none',
              color: 'var(--mac-text-secondary)',
              p: 0,
              minWidth: 'auto',
              '&:hover': { color: 'var(--sakay-orange)' },
            }}
          >
            Add
          </Button>
        </Box>

        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.8 }}>
          {savedSwatches.map((hex) => {
            const isSelected = currentColorHex.toUpperCase() === hex.toUpperCase();
            return (
              <Box
                key={hex}
                onClick={() => {
                  const newHsv = hexToHsv(hex);
                  setHsv(newHsv);
                  setHexInput(hex.toUpperCase());
                  onChange(hex.toUpperCase());
                }}
                sx={{
                  width: 26,
                  height: 26,
                  borderRadius: '50%',
                  backgroundColor: hex,
                  cursor: 'pointer',
                  border: isSelected ? `2.5px solid var(--mac-text-primary)` : '1px solid rgba(0,0,0,0.15)',
                  boxShadow: isSelected ? '0 0 0 2px rgba(0,0,0,0.1)' : 'none',
                  transition: 'all 0.15s ease',
                  '&:hover': { transform: 'scale(1.15)' },
                }}
              />
            );
          })}
        </Box>
      </Box>
    </Box>
  );
};
