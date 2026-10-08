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

/* Learning mode styles live in themes/translation.ts */

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

/* Animation definitions (all keyframes are wxt-prefixed to avoid clashing with page styles) */
@keyframes wxt-glow-animation {
  from {
    background-color: rgba(106, 136, 224, 0.3);
    box-shadow: 0 0 8px rgba(106, 136, 224, 0.5);
  }
  to {
    background-color: transparent;
    box-shadow: 0 0 0 transparent;
  }
}

@keyframes wxt-processing-animation {
  0% { background-color: rgba(106, 136, 224, 0.1); }
  50% { background-color: rgba(106, 136, 224, 0.3); }
  100% { background-color: rgba(106, 136, 224, 0.1); }
}

/* Brief highlight after a segment has been translated */
.wxt-glow {
  animation: wxt-glow-animation 0.8s ease-out;
  border-radius: 3px;
}

/* Pulse while a segment is being translated (removed when processing ends) */
.wxt-processing {
  animation: wxt-processing-animation 2s infinite ease-in-out;
  border-radius: 3px;
  transition: background-color 0.3s ease-out;
}

@media (prefers-reduced-motion: reduce) {
  .wxt-glow,
  .wxt-processing {
    animation: none !important;
  }
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
