import React, { useEffect, useState } from 'react';
import { Box, Button, ButtonBase, Typography } from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';

import { SettingRow } from '../common/SettingRow';
import { SakayToast } from '../common/SakayToast';
import { EmbeddedColorPicker } from './AccentColorPicker';
import { useTheme } from '../../contexts/ThemeContext';
import { FONT } from '../../styles/density';
import { PAGE_BORDER, PAGE_TEXT, pageFocusRing } from '../../styles/pageTheme';

const PRESET_SWATCHES = [
  { name: 'SAKAY Orange', hex: '#FF6600' },
  { name: 'Municipal Blue', hex: '#2563EB' },
  { name: 'City Emerald', hex: '#059669' },
  { name: 'Royal Violet', hex: '#7C3AED' },
  { name: 'Rose Pink', hex: '#DB2777' },
  { name: 'Crimson Red', hex: '#DC2626' },
];

// System Appearance (it used to sit inside Account Management): the accent colour of the portal. The choice is kept by the portal's ThemeContext exactly as before
// (in this browser and in the administrator's profile); this panel only picks a colour and asks the context to save it. There is no second copy of the setting.
export const AppearancePanel: React.FC = () => {
  const { themeColor, setThemeColor } = useTheme();
  const [selectedColor, setSelectedColor] = useState(themeColor);
  const [isSavingTheme, setIsSavingTheme] = useState(false);
  const [toastOpen, setToastOpen] = useState(false);

  useEffect(() => {
    setSelectedColor(themeColor);
  }, [themeColor]);

  const handleSaveTheme = async () => {
    setIsSavingTheme(true);
    try {
      await setThemeColor(selectedColor);
      setToastOpen(true);
    } catch (err: any) {
      console.error('Failed to save theme color:', err);
    } finally {
      setIsSavingTheme(false);
    }
  };

  return (
    <>
      <SettingRow title="Accent colour" description="The main colour of buttons and highlights in the SAKAY LGU Portal. Choose one of these, or pick your own below.">
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(3, minmax(0, 1fr))' }, gap: '10px', mt: '14px', maxWidth: 560 }}>
          {PRESET_SWATCHES.map((swatch) => {
            const isSelected = selectedColor.toUpperCase() === swatch.hex.toUpperCase();
            return (
              <ButtonBase
                key={swatch.hex}
                onClick={() => setSelectedColor(swatch.hex)}
                aria-pressed={isSelected}
                disableRipple
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'flex-start',
                  gap: '10px',
                  padding: '8px 10px',
                  minHeight: 40,
                  borderRadius: '10px',
                  textAlign: 'left',
                  border: isSelected ? `2px solid ${swatch.hex}` : `1px solid ${PAGE_BORDER}`,
                  backgroundColor: '#FFFFFF',
                  '&:hover': { borderColor: swatch.hex },
                  ...pageFocusRing,
                }}
              >
                <Box aria-hidden sx={{ width: 20, height: 20, borderRadius: '50%', backgroundColor: swatch.hex, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  {isSelected && <CheckIcon sx={{ color: '#FFFFFF', fontSize: 13 }} />}
                </Box>
                <Typography sx={{ fontSize: FONT.body, fontWeight: isSelected ? 700 : 500, color: PAGE_TEXT.primary }}>{swatch.name}</Typography>
              </ButtonBase>
            );
          })}
        </Box>
      </SettingRow>

      <SettingRow title="Custom colour" description="Pick any other colour. The preview below shows how a button will look.">
        <Box sx={{ mt: '14px', maxWidth: 560 }}>
          <EmbeddedColorPicker color={selectedColor} onChange={(newHex) => setSelectedColor(newHex)} />
        </Box>

        <Box
          sx={{
            mt: '14px',
            maxWidth: 560,
            padding: '12px 16px',
            borderRadius: '12px',
            border: `1px solid ${PAGE_BORDER}`,
            backgroundColor: '#FAFAF8',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '8px 16px',
          }}
        >
          <Box>
            <Typography sx={{ fontSize: FONT.body, fontWeight: 600, color: PAGE_TEXT.primary }}>Preview</Typography>
            <Typography sx={{ fontSize: FONT.small, color: PAGE_TEXT.secondary, mt: '2px' }}>Colour chosen: {selectedColor.toUpperCase()}</Typography>
          </Box>
          <Button
            variant="contained"
            tabIndex={-1}
            aria-hidden
            sx={{ backgroundColor: selectedColor, color: '#FFFFFF', borderRadius: '8px', textTransform: 'none', fontSize: FONT.small, fontWeight: 600, boxShadow: 'none', pointerEvents: 'none', '&:hover': { backgroundColor: selectedColor, boxShadow: 'none' } }}
          >
            Sample button
          </Button>
        </Box>

        <Button
          variant="contained"
          onClick={handleSaveTheme}
          disabled={isSavingTheme || selectedColor === themeColor}
          sx={{
            mt: '14px',
            minHeight: 36,
            '@media (pointer: coarse)': { minHeight: 44 },
            px: '18px',
            borderRadius: '8px',
            textTransform: 'none',
            fontSize: FONT.body,
            fontWeight: 700,
            boxShadow: 'none',
            // the button wears the colour that is about to be saved
            backgroundColor: selectedColor,
            '&:hover': { backgroundColor: selectedColor, boxShadow: 'none', filter: 'brightness(0.92)' },
            ...pageFocusRing,
          }}
        >
          {isSavingTheme ? 'Saving...' : 'Save colour'}
        </Button>
      </SettingRow>

      <SakayToast open={toastOpen} message="The portal colour was saved." severity="success" onClose={() => setToastOpen(false)} />
    </>
  );
};
