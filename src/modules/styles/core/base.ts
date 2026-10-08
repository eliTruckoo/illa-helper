/**
 * Base styles
 * Base style definitions for translation elements, rebuilt from the original styles
 */

export const BASE_STYLES = `
/* Base styles */
.wxt-word-container {
  display: inline;
  position: relative;
}

.wxt-chinese {
  display: inline;
}

.wxt-original-word {
  background: linear-gradient(to right, var(--wxt-primary-color) 0%, var(--wxt-primary-color) 50%, transparent 50%, transparent 100%) repeat-x left bottom;
  background-size: 8px 2px;
  padding-bottom: 2px;
}

.wxt-english {
  display: inline;
  margin-left: 4px;
  font-size: 0.9em;
  vertical-align: baseline;
}

/* Learning mode styles */
.wxt-translation-term--learning {
  filter: blur(5px);
  cursor: pointer;
  color: var(--wxt-primary-color);
  transition: filter 0.2s ease-in-out;
}

.wxt-translation-term--learning:hover {
  filter: blur(0);
}

/* Learning mode original text styles - enhanced hover support */
.wxt-original-word--learning {
  filter: blur(5px);
  cursor: pointer;
  transition: filter 0.2s ease-in-out;
}

.wxt-original-word--learning:hover {
  filter: blur(0) !important;
}

/* Enhanced hover support for learning mode inside a tags */
a .wxt-original-word--learning:hover,
a:hover .wxt-original-word--learning {
  filter: blur(0) !important;
}

/* Phrase translation two-layer interaction styles */
.wxt-has-word-overlay {
  position: relative !important;
}

.wxt-word-hover-area {
  position: absolute;
  pointer-events: auto;
  z-index: 1;
  background: transparent;
  cursor: pointer;
  transition: background-color 0.2s ease;
  border-radius: 2px;
}

.wxt-word-hover-area:hover {
  background-color: rgba(106, 136, 224, 0.1) !important;
}

.wxt-word-hover-area.wxt-pronunciation-enabled:hover {
  background-color: rgba(106, 136, 224, 0.15) !important;
}

/* Processing state styles */
.wxt-processing {
  pointer-events: none !important;
}

/* Ensure link elements remain clickable while processing */
a.wxt-processing,
a.wxt-processing *,
.wxt-processing a,
.wxt-processing a * {
  pointer-events: auto !important;
  cursor: pointer !important;
}

/* Ensure button elements remain clickable while processing */
button.wxt-processing,
button.wxt-processing *,
.wxt-processing button,
.wxt-processing button * {
  pointer-events: auto !important;
  cursor: pointer !important;
}

/* Ensure clickable elements remain clickable while processing */
[onclick].wxt-processing,
[onclick].wxt-processing *,
.wxt-processing [onclick],
.wxt-processing [onclick] * {
  pointer-events: auto !important;
  cursor: pointer !important;
}


/* Error state styles */
.wxt-error {
  color: #ff6b6b !important;
  text-decoration: line-through;
}

/* Responsive adaptation */
@media (max-width: 768px) {
  .wxt-word-container {
    font-size: 14px;
  }

  .wxt-english {
    font-size: 0.85em;
  }
}

/* Animation definitions */
@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

/* ===== Translation state control system ===== */

/**
 * Global translation state control
 *
 * Principle: toggle a CSS class on body to control the display state of all translated content
 * Advantages:
 * - High performance: avoids per-element operations
 * - Automatic inheritance: newly added translated content picks up the current state
 * - Unified management: all translated content stays in sync
 */
.wxt-translation-hidden .wxt-translation-term {
  display: none !important;
}

/**
 * State switch transition effects
 * Provides a smooth visual transition when translated content is shown or hidden
 */
.wxt-translation-term {
  transition: opacity 0.2s ease-in-out;
}
`;
