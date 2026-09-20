/**
 * SAKAY Centralized Typography System Tokens
 * All font sizes are defined in rem units based on a standard 16px root.
 */

export const TYPOGRAPHY_TOKENS = {
  // Font Sizes
  fontSize: {
    micro: '0.6875rem',    // 11px - Micro status badges, compact indicators
    caption: '0.75rem',     // 12px - Timestamps, secondary metadata, helper text
    secondary: '0.875rem',  // 14px - Secondary text, desktop table body/inputs/buttons
    buttonMobile: '0.9375rem', // 15px - Mobile primary action buttons
    buttonDesktop: '0.875rem', // 14px - Desktop buttons
    bodyMobile: '1rem',        // 16px - Mobile body text, form input text
    bodyDesktop: '0.875rem',   // 14px - Desktop body text
    section: '1.125rem',    // 18px - Section titles, card titles, dialog titles
    pageTitle: '1.5rem',    // 24px - Main screen headings, login headings
    display: '1.75rem',     // 28px - Hero information, driver fare figures
    metric: '2rem',         // 32px - Dashboard KPI summary stats
  },

  // Line Heights
  lineHeight: {
    tight: 1.2,     // Buttons, titles, KPI figures
    heading: 1.3,   // Section titles, dialog titles
    secondary: 1.4, // Secondary metadata, captions
    relaxed: 1.5,   // Readable body text
  },

  // Font Weights
  fontWeight: {
    regular: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },
} as const;

export type TypographyTokenKey = keyof typeof TYPOGRAPHY_TOKENS.fontSize;
