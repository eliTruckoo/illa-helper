/**
 * Translation style themes
 * Contains the various translation style definitions
 */

export const TRANSLATION_STYLES = `
/* Default style */
.wxt-style-default {
  color: var(--wxt-primary-color);
  font-weight: 500;
}

/* Subtle style */
.wxt-style-subtle {
  color: var(--wxt-label-color);
  opacity: 0.9;
}

/* Bold style */
.wxt-style-bold {
  color: var(--wxt-primary-color);
  font-weight: bold;
}

/* Italic style */
.wxt-style-italic {
  color: var(--wxt-primary-color);
  font-style: italic;
}

/* Underline style */
.wxt-style-underlined {
  color: var(--wxt-primary-color);
  text-decoration-line: underline;
  text-decoration-color: var(--wxt-accent-color);
  text-decoration-thickness: 2px;
  text-underline-offset: 3px;
}

/* Highlight style */
.wxt-style-highlighted {
  color: #212529;
  background-color: #ffeb3b;
  padding: 0 2px;
  border-radius: 2px;
}

/* Dotted underline style */
.wxt-style-dotted {
  background: linear-gradient(to right, #57bcb8 0%, #59c1bf 50%, transparent 50%, transparent 100%) repeat-x left bottom;
  background-size: 8px 2px;
  padding-bottom: 2px;
}

.wxt-style-dotted:hover {
  border-color: var(--wxt-primary-color);
}

/* Learning mode style */
.wxt-translation-term--learning {
  filter: blur(5px);
  cursor: pointer;
  color: var(--wxt-primary-color);
  transition: filter 0.2s ease-in-out;
}

.wxt-translation-term--learning:hover {
  filter: blur(0);
}

/* Learning mode original text style - enhanced hover support */
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
/* Paragraph translation state control */
.wxt-translation-hidden .illa-paragraph-translation {
  display: none !important;
}

/* Hidden display mode: the translated copy replaces the original paragraph
   while translations are shown */
body:not(.wxt-translation-hidden) .illa-paragraph-original--hidden {
  display: none !important;
}
`;
