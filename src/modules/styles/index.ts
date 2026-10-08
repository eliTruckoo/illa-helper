/**
 * Style module index
 * Exports all style-related modules and classes
 */

// Import all style constants
import { CSS_VARIABLES } from './constants/variables';
import { BASE_STYLES } from './core/base';
import { TRANSLATION_STYLES } from './themes/translation';
import { PRONUNCIATION_STYLES } from './components/pronunciation';
import { TOOLTIP_STYLES } from './components/tooltip';

// Export style constants
export {
  CSS_VARIABLES,
  BASE_STYLES,
  TRANSLATION_STYLES,
  PRONUNCIATION_STYLES,
  TOOLTIP_STYLES,
};

// Export the StyleManager class (avoids circular dependencies)
export { StyleManager } from './core/StyleManager';

// Merge all styles
export const ALL_STYLES = `
${CSS_VARIABLES}
${BASE_STYLES}
${TRANSLATION_STYLES}
${PRONUNCIATION_STYLES}
${TOOLTIP_STYLES}
`;
