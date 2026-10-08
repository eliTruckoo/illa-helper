/**
 * CSS variable constants
 * Defines the base variables of the style system
 */

export const CSS_VARIABLES = `
:root {
  --wxt-primary-color: #6a88e0;
  --wxt-accent-color: #ffafcc;
  --wxt-label-color: #546e7a;
}
`;

/**
 * CSS variable enum
 */
export const STYLE_VARS = {
  PRIMARY_COLOR: '#6a88e0',
  ACCENT_COLOR: '#ffafcc',
  LABEL_COLOR: '#546e7a',
  TOOLTIP_BG: '#2c2c2e',
  TOOLTIP_BORDER: '#48484a',
  PHONETIC_COLOR: '#64ffda',
  ERROR_COLOR: '#ff9999',
  SUCCESS_COLOR: '#1de9b6',
} as const;

/**
 * Animation constants
 */
export const ANIMATIONS = {
  TOOLTIP_APPEAR: 'wxt-tooltip-appear 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
  SPIN: 'spin 1s linear infinite',
  TRANSITION_FAST: '0.2s ease',
  TRANSITION_SMOOTH: '0.2s cubic-bezier(0.4, 0, 0.2, 1)',
} as const;

/**
 * Z-index layers
 */
export const Z_INDEX = {
  TOOLTIP: 10000,
  HOVER_AREA: 1,
} as const;
