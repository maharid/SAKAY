/**
 * SAKAY Centralized Typography System Tokens
 * All font sizes are defined in rem units based on a standard 16px root.
 */

export const TYPOGRAPHY_TOKENS = {
  // Font Sizes (Revised Phone-First Compact Scale)
  fontSize: {
    micro: '0.5625rem',       // 9px - Micro status badges, tiny metadata
    caption: '0.625rem',       // 10px - Timestamps, secondary subtext, helper text
    secondary: '0.6875rem',    // 11px - Filter pills, notification body, secondary text
    buttonMobile: '0.75rem',   // 12px - Mobile button labels, card titles, item titles
    buttonDesktop: '0.875rem', // 14px - Desktop buttons (Unchanged for LGU/TODA)
    bodyMobile: '0.8125rem',   // 13px - Primary mobile body text, input text
    bodyDesktop: '0.875rem',   // 14px - Desktop body text (Unchanged for LGU/TODA)
    section: '0.875rem',       // 14px - Section titles, card subheadings
    pageTitle: '1rem',         // 16px - Main screen page titles, inner screen headers
    display: '1.375rem',       // 22px - Hero figures, fare amounts
    metric: '1.625rem',        // 26px - Dashboard KPI summary stats
  },

  // Line Heights (Tightened for Mobile Efficiency & Readability)
  lineHeight: {
    tight: 1.15,    // Buttons, titles, KPI figures
    heading: 1.25,   // Section titles, dialog titles
    secondary: 1.35, // Secondary metadata, captions
    relaxed: 1.4,    // Readable body text
  },

  // Font Weights
  fontWeight: {
    regular: 400,
    medium: 500,     // Recommended default for micro & caption text (10px–12px)
    semibold: 600,   // Emphasized small text & secondary titles
    bold: 700,
  },
} as const;

export type TypographyTokenKey = keyof typeof TYPOGRAPHY_TOKENS.fontSize;
