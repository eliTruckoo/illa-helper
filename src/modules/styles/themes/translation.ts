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

/*
 * Learning mode: the word is concealed and revealed on hover.
 * A per-word filter: blur() forces a separate compositing/paint pass for every
 * word, so the text is hidden with a transparent fill on a solid mask instead.
 * -webkit-text-fill-color (supported by Chrome and Firefox) is inherited by
 * nested elements and leaves the page's own color values untouched.
 */
.wxt-translation-term--learning,
.wxt-original-word--learning {
  -webkit-text-fill-color: transparent;
  text-shadow: none;
  background-color: rgba(127, 127, 127, 0.28);
  border-radius: 3px;
  cursor: pointer;
  transition:
    background-color 0.2s ease-in-out,
    -webkit-text-fill-color 0.2s ease-in-out;
}

.wxt-translation-term--learning {
  color: var(--wxt-primary-color);
}

.wxt-translation-term--learning:hover,
.wxt-original-word--learning:hover,
a:hover .wxt-original-word--learning {
  -webkit-text-fill-color: currentcolor !important;
  background-color: transparent !important;
}

@media (prefers-reduced-motion: reduce) {
  .wxt-translation-term--learning,
  .wxt-original-word--learning {
    transition: none;
  }
}
/* Paragraph translation state control */
.wxt-translation-hidden .illa-paragraph-translation {
  display: none !important;
}
`;
