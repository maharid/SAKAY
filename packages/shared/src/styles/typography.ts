/**
 * SAKAY Centralized Typography System Tokens
 * All font sizes are defined in rem units based on a standard 16px root.
 */

export const TYPOGRAPHY_TOKENS = {
  // Font Sizes (Established Mobile SAKAY Scale)
  fontSize: {
    micro: '0.75rem',         // 12px - Smallest text allowed: timestamps, micro badges (nothing is set below 12px)
    caption: '0.75rem',       // 12px - Captions, helper text, subtext
    secondary: '0.8125rem',   // 13px - Filter pills, secondary labels, card body
    buttonMobile: '0.9375rem',// 15px - Mobile buttons, item titles
    buttonDesktop: '0.9375rem',// 15px - Buttons
    bodyMobile: '0.875rem',   // 14px - Primary mobile body text
    bodyDesktop: '0.875rem',  // 14px - Body text
    section: '1rem',          // 16px - Section headers, card titles, inputs
    pageTitle: '1.0625rem',   // 17px - Header titles, screen titles
    display: '1.25rem',       // 20px - Prominent values (fare amounts, hero figures)
    metric: '1.5rem',         // 24px - KPI summary metrics
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
    medium: 500,     // Recommended default for caption text (12px)
    semibold: 600,   // Emphasized small text & secondary titles
    bold: 700,       // The heaviest weight in use (the apps load 400 / 500 / 600 / 700)
  },
} as const;

export type TypographyTokenKey = keyof typeof TYPOGRAPHY_TOKENS.fontSize;
