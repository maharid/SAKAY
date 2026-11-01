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
import { ToolbarRow } from '@sakay/shared';

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
  /** A short word shown before the chosen value, so a closed drop-down says what it filters ("Status · All") */
  prefix?: string;
}

export interface FilterToolbarProps {
  searchQuery?: string;
  onSearchChange?: (query: string) => void;
  searchPlaceholder?: string;
  selectFilters?: SelectFilterProps[];
  onResetFilters?: () => void;
  actionButton?: React.ReactNode;
  /** More controls beside the drop-downs (for example a date field) */
  extraControls?: React.ReactNode;
  disableMarginBottom?: boolean;
  /**
   * A card of its own BESIDE the search (the export, or the page's actions: see ToolbarRow). With one filter or none, the search and the filter share one card next to it; with
   * more, the search sits alone beside it and the filters get a card of their own under them, so no card ever takes two lines.
   */
  sideCard?: React.ReactNode;
  /** Forces (true) or forbids (false) the filters-in-their-own-card layout; left out, it is used when there are two or more filters */
  splitFilters?: boolean;
}

// The controls share one height: 36px for a mouse, 44px for a finger.
const CONTROL_HEIGHT = 36;
const touchHeight = { '@media (pointer: coarse)': { height: 44 } };

const CARD_SX = {
  p: '13px',
  borderRadius: '14px',
  border: '1px solid var(--mac-border-color)',
  backgroundColor: '#FFFFFF',
  boxShadow: 'var(--mac-shadow-card)',
} as const;

// card with the search box, the filters and Reset together on the left (they wrap onto a new line on a narrow screen), and the page's own action on the right
export const FilterToolbar: React.FC<FilterToolbarProps> = ({
  searchQuery = '',
  onSearchChange,
  searchPlaceholder = 'Search records...',
  selectFilters = [],
  onResetFilters,
  actionButton,
  extraControls,
  disableMarginBottom = false,
  sideCard,
  splitFilters,
}) => {
  const marginBottom = disableMarginBottom ? 0 : 22;
  const hasControls = selectFilters.length > 0 || Boolean(extraControls) || Boolean(onResetFilters) || Boolean(actionButton);
  const split = Boolean(sideCard) && (splitFilters ?? selectFilters.length + (extraControls ? 1 : 0) >= 2);

  // search: takes the room it needs (up to 440px) so the placeholder is readable; on its own beside a side card it takes the whole width
  const search = (wide: boolean) =>
    onSearchChange ? (
      <Box sx={wide ? { flex: '1 1 100%', minWidth: 0 } : { flex: { xs: '1 1 100%', sm: '1 1 260px' }, maxWidth: { sm: 440 }, minWidth: 0 }}>
        <TextField
          size="small"
          placeholder={searchPlaceholder}
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          slotProps={{
            htmlInput: { 'aria-label': searchPlaceholder },
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" sx={{ color: 'var(--mac-text-secondary)', fontSize: 16 }} />
                </InputAdornment>
              ),
            },
          }}
          sx={{
            width: '100%',
            '& .MuiOutlinedInput-root': {
              borderRadius: '8px',
              backgroundColor: '#FAFAFC',
              fontSize: '12px',
              height: CONTROL_HEIGHT,
              border: '1px solid rgba(15, 23, 42, 0.14)',
              transition: 'var(--mac-transition-fast)',
              ...touchHeight,
              '& fieldset': { border: 'none' },
              '& input::placeholder': { color: '#65656a', opacity: 1 },
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
      </Box>
    ) : null;

  // the filters, each one a drop-down (on a phone they use the full width), then the extra controls, Reset and the page's action
  const controls = (
    <>
      {selectFilters.map((filter) => (
        <FormControl
          key={filter.id}
          size="small"
          sx={{
            minWidth: { xs: '100%', sm: filter.width || 168 },
            flex: { xs: '1 1 100%', sm: '0 0 auto' },
          }}
        >
          <Select
            value={filter.value}
            onChange={(e) => filter.onChange(e.target.value)}
            displayEmpty
            renderValue={
              filter.prefix
                ? (value) => (
                    <span>
                      <Box component="span" sx={{ color: 'var(--mac-text-secondary)', fontWeight: 400 }}>{filter.prefix} · </Box>
                      {filter.options.find((o) => o.value === value)?.label ?? String(value)}
                    </span>
                  )
                : undefined
            }
            SelectDisplayProps={filter.label ? { 'aria-label': filter.label } : undefined}
            sx={{
              borderRadius: '8px',
              backgroundColor: '#FAFAFC',
              fontSize: '12px',
              fontWeight: 500,
              color: 'var(--mac-text-primary)',
              height: CONTROL_HEIGHT,
              border: '1px solid rgba(15, 23, 42, 0.14)',
              ...touchHeight,
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
              <MenuItem key={opt.value} value={opt.value} sx={{ fontSize: '12px' }}>
                {opt.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      ))}

      {extraControls}

      {onResetFilters && (
        <Button
          size="small"
          onClick={onResetFilters}
          startIcon={<RestartAltIcon fontSize="small" sx={{ fontSize: 16 }} />}
          sx={{
            height: CONTROL_HEIGHT,
            padding: '0 13px',
            borderRadius: '8px',
            border: '1px solid rgba(15, 23, 42, 0.14)',
            backgroundColor: '#FFFFFF',
            color: 'var(--mac-text-primary)',
            fontSize: '12px',
            fontWeight: 600,
            textTransform: 'none',
            flexShrink: 0,
            ...touchHeight,
            '&:hover': {
              backgroundColor: 'var(--sakay-orange-soft)',
              borderColor: 'var(--sakay-orange-border)',
            },
            '&:focus-visible': { outline: '2px solid #B34700', outlineOffset: '2px' },
          }}
        >
          Reset
        </Button>
      )}

      {actionButton && (
        <Box sx={{ flex: { xs: '1 1 100%', sm: '0 0 auto' }, minWidth: 0, ml: { sm: 'auto' } }}>
          {actionButton}
        </Box>
      )}
    </>
  );

  const row = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px' } as const;

  // the search beside the side card, the filters in a card of their own under both
  if (split) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '14px', mb: `${marginBottom}px` }}>
        <ToolbarRow side={sideCard} marginBottom={0}>
          <Card elevation={0} sx={CARD_SX}>
            <Box sx={row}>{search(true)}</Box>
          </Card>
        </ToolbarRow>
        {hasControls && (
          <Card elevation={0} sx={CARD_SX}>
            <Box sx={row}>{controls}</Box>
          </Card>
        )}
      </Box>
    );
  }

  const card = (
    <Card elevation={0} sx={{ ...CARD_SX, mb: sideCard ? 0 : `${marginBottom}px` }}>
      <Box sx={row}>
        {search(false)}
        {controls}
      </Box>
    </Card>
  );
  return sideCard ? <ToolbarRow side={sideCard} marginBottom={marginBottom}>{card}</ToolbarRow> : card;
};
