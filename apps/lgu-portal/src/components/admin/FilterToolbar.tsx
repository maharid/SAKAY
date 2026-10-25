import React from 'react';
import {
  Box,
  Card,
  TextField,
  InputAdornment,
  FormControl,
  Select,
  MenuItem,
  Button,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import { CONTROL, FONT } from '../../styles/density';

export interface FilterOption {
  label: string;
  value: string;
}

export interface SelectFilterProps {
  id: string;
  label?: string;
  value: string;
  options: FilterOption[];
  onChange: (value: string) => void;
  width?: number | string;
}

export interface FilterToolbarProps {
  searchQuery?: string;
  onSearchChange?: (query: string) => void;
  searchPlaceholder?: string;
  selectFilters?: SelectFilterProps[];
  onResetFilters?: () => void;
  actionButton?: React.ReactNode;
  disableMarginBottom?: boolean;
  /** For a toolbar with many filters (more than will sit beside the search box): the search box on its own row, and the filters under it in one even row (Reset and the action on the right) */
  stacked?: boolean;
}

export const FilterToolbar: React.FC<FilterToolbarProps> = ({
  searchQuery = '',
  onSearchChange,
  searchPlaceholder = 'Search records...',
  selectFilters = [],
  onResetFilters,
  actionButton,
  disableMarginBottom = false,
  stacked = false,
}) => {
  return (
    <Card
      elevation={0}
      sx={{
        p: 1.6,
        borderRadius: 'var(--mac-radius-lg)',
        border: '1px solid var(--mac-border-color)',
        backgroundColor: '#FFFFFF',
        boxShadow: 'var(--mac-shadow-card)',
        mb: disableMarginBottom ? 0 : 2.8,
      }}
    >
      <Box
        sx={{
          display: 'flex',
          flexDirection: stacked ? 'column' : { xs: 'column', md: 'row' },
          alignItems: stacked ? 'stretch' : { xs: 'stretch', md: 'center' },
          justifyContent: 'space-between',
          gap: 1.6,
        }}
      >
        {/* Left side: Search Field */}
        <Box sx={stacked ? { width: '100%', maxWidth: 440 } : { flex: { xs: '1 1 100%', md: '0 1 360px' } }}>
          {onSearchChange && (
            <TextField
              size="small"
              placeholder={searchPlaceholder}
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon fontSize="small" sx={{ color: 'var(--mac-text-muted)', fontSize: '14px' }} />
                    </InputAdornment>
                  ),
                },
                htmlInput: { 'aria-label': searchPlaceholder },
              }}
              sx={{
                width: '100%',
                '& .MuiOutlinedInput-root': {
                  borderRadius: '10px',
                  backgroundColor: '#FAFAFC',
                  fontSize: FONT.body,
                  height: CONTROL.height,
                  '@media (pointer: coarse)': { height: CONTROL.touchHeight },
                  border: '1px solid var(--mac-border-color)',
                  transition: 'var(--mac-transition-fast)',
                  '& fieldset': { border: 'none' },
                  '&:hover': {
                    backgroundColor: '#FFFFFF',
                    borderColor: 'var(--sakay-orange-border)',
                  },
                  '&.Mui-focused': {
                    backgroundColor: '#FFFFFF',
                    boxShadow: '0 0 0 3px var(--sakay-orange-glow)',
                    border: '1px solid var(--sakay-orange)',
                  },
                },
              }}
            />
          )}
        </Box>

        {/* Rightmost side: Select Dropdowns, Reset Button & Optional Action Button */}
        <Box
          sx={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: stacked ? 'flex-start' : { xs: 'flex-start', md: 'flex-end' },
            gap: 1.2,
            ml: stacked ? 0 : { md: 'auto' },
            width: stacked ? '100%' : undefined,
          }}
        >
          {/* Dynamic Select Filters */}
          {selectFilters.map((filter) => (
            <FormControl
              key={filter.id}
              size="small"
              sx={stacked ? { flex: '1 1 150px', minWidth: 140, maxWidth: 240 } : { minWidth: filter.width || 160, flexShrink: 0 }}
            >
              <Select
                value={filter.value}
                onChange={(e) => filter.onChange(e.target.value)}
                displayEmpty
                SelectDisplayProps={{ 'aria-label': filter.label ?? filter.id }}
                sx={{
                  borderRadius: '10px',
                  backgroundColor: '#FAFAFC',
                  fontSize: FONT.body,
                  fontWeight: 500,
                  color: 'var(--mac-text-primary)',
                  height: CONTROL.height,
                  '@media (pointer: coarse)': { height: CONTROL.touchHeight },
                  border: '1px solid var(--mac-border-color)',
                  '& fieldset': { border: 'none' },
                  '&:hover': {
                    borderColor: 'var(--sakay-orange-border)',
                    backgroundColor: '#FFFFFF',
                  },
                  '&.Mui-focused': {
                    boxShadow: '0 0 0 3px var(--sakay-orange-glow)',
                    border: '1px solid var(--sakay-orange)',
                    backgroundColor: '#FFFFFF',
                  },
                }}
              >
                {filter.options.map((opt) => (
                   <MenuItem key={opt.value} value={opt.value} sx={{ fontSize: FONT.body }}>
                    {opt.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          ))}

          {/* Reset Filter Button */}
          {onResetFilters && (
            <Button
              size="small"
              onClick={onResetFilters}
              startIcon={<RestartAltIcon fontSize="small" sx={{ fontSize: '14px' }} />}
              sx={{
                height: CONTROL.height,
                '@media (pointer: coarse)': { height: CONTROL.touchHeight },
                padding: '0 13px',
                borderRadius: '10px',
                border: '1px solid var(--mac-border-color)',
                backgroundColor: '#FAFAFC',
                color: 'var(--mac-text-secondary)',
                fontSize: FONT.small,
                fontWeight: 500,
                textTransform: 'none',
                flexShrink: 0,
                // stacked: Reset and the action button sit together at the right end of the row
                ml: stacked ? 'auto' : undefined,
                '&:hover': {
                  backgroundColor: 'var(--sakay-orange-soft)',
                  color: 'var(--sakay-orange)',
                  borderColor: 'var(--sakay-orange-border)',
                },
              }}
            >
              Reset
            </Button>
          )}

          {/* Optional Action Button */}
          {actionButton && (
            <Box sx={{ flexShrink: 0, ml: stacked && !onResetFilters ? 'auto' : 0.4 }}>
              {actionButton}
            </Box>
          )}
        </Box>
      </Box>
    </Card>
  );
};
