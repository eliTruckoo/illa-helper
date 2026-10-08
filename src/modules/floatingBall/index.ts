/**
 * Floating ball module entry
 */

// Export types
export type {
  FloatingBallConfig,
  FloatingBallState,
  FloatingBallEventType,
} from './types';

// Export configuration
export {
  DEFAULT_FLOATING_BALL_CONFIG,
  FLOATING_BALL_STYLES,
  DRAG_CONFIG,
} from './config';

// Export manager
export { FloatingBallManager } from './managers/FloatingBallManager';
