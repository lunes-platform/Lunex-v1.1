import { createGlobalStyle, css } from 'styled-components'

/**
 * Global styles — Lunex redesign.
 *
 * - Inter for body copy; Space Grotesk only for headings, buttons and
 *   numbers (it used to be applied to `*`, overriding Inter everywhere).
 * - Motion durations follow styles/motion.ts (150 / 200 / 300ms).
 * - Press feedback (scale .98) is scoped to primary CTAs via `data-cta`.
 * - Borderless inputs (`data-bare`) move their focus ring to the container
 *   (`data-field`).
 * - Reduced motion: everything off; spinners / skeletons / glows become an
 *   opacity pulse (`data-motion="pulse"`) instead of freezing.
 */
export default createGlobalStyle`
${({ theme }) => css`
  *,
  *::before,
  *::after {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }

  html {
    font-size: 62.5%;
    scroll-behavior: smooth;
  }

  body {
    min-height: 100%;
    font-family: 'Inter', system-ui, sans-serif;
    font-size: 14px;
    line-height: 1.5;
    text-rendering: optimizelegibility;
    -webkit-font-smoothing: antialiased;
    color: ${theme.colors.themeColors[100]};
    background: ${theme.colors.themeColors[500]};
    overflow-x: hidden;
  }

  h1,
  h2,
  h3,
  h4,
  h5,
  h6,
  button {
    font-family: 'Space Grotesk', 'Inter', sans-serif;
  }

  input,
  textarea,
  select {
    font-family: inherit;
    color: inherit;
  }

  input::placeholder,
  textarea::placeholder {
    color: #6d6d6d;
  }

  .num,
  [data-num] {
    font-family: 'Space Grotesk', 'Inter', sans-serif;
    font-variant-numeric: tabular-nums;
  }

  button {
    cursor: pointer;
    border: none;
    background: none;
    color: inherit;
    white-space: nowrap;
    transition:
      background-color 150ms ease,
      border-color 150ms ease,
      color 150ms ease,
      transform 120ms ease,
      opacity 150ms ease;
  }

  button:disabled {
    cursor: not-allowed;
  }

  button[data-cta]:active:not(:disabled) {
    transform: scale(0.98);
  }

  a {
    color: ${theme.colors.primary[300]};
    text-decoration: none;
    transition: color 150ms ease;
  }

  a:hover {
    color: ${theme.colors.primary[200]};
  }

  ul {
    list-style: none;
  }

  img {
    display: block;
  }

  :focus-visible {
    outline: 2px solid ${theme.colors.primary[500]};
    outline-offset: 2px;
  }

  [role='dialog']:focus {
    outline: none;
  }

  input,
  textarea,
  select {
    transition:
      border-color 150ms ease,
      box-shadow 150ms ease;
  }

  input:not([data-bare]):not([type='range']):not([type='checkbox']):focus,
  textarea:focus,
  select:focus {
    outline: none;
    box-shadow: 0 0 0 3px rgba(108, 56, 255, 0.25);
  }

  input[data-bare]:focus,
  input[data-bare]:focus-visible {
    outline: none;
    box-shadow: none;
  }

  [data-field]:has(input[data-bare]:focus-visible) {
    border-color: ${theme.colors.primary[500]} !important;
    box-shadow: 0 0 0 3px rgba(108, 56, 255, 0.22);
  }

  input[type='range'] {
    accent-color: ${theme.colors.primary[500]};
  }

  input[type='checkbox'] {
    accent-color: ${theme.colors.primary[500]};
  }

  /* Scrollbars — 4px, nearly invisible at rest */
  * {
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.08) transparent;
  }

  *:hover {
    scrollbar-color: rgba(255, 255, 255, 0.18) transparent;
  }

  ::-webkit-scrollbar {
    width: 4px;
    height: 4px;
  }

  ::-webkit-scrollbar-track,
  ::-webkit-scrollbar-corner {
    background: transparent;
  }

  ::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.08);
    border-radius: 999px;
  }

  *:hover::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.18);
  }

  ::-webkit-scrollbar-thumb:hover {
    background: rgba(108, 56, 255, 0.6);
  }

  [role='dialog'] {
    overscroll-behavior: contain;
  }

  [role='dialog']::-webkit-scrollbar-track {
    margin: 16px 0;
  }

  /* Hide native number spinners */
  input[type='number']::-webkit-inner-spin-button,
  input[type='number']::-webkit-outer-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }

  input[type='number'] {
    -moz-appearance: textfield;
    appearance: textfield;
  }

  @keyframes lxpulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.35;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    html {
      scroll-behavior: auto;
    }

    *,
    *::before,
    *::after {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important;
      scroll-behavior: auto !important;
    }

    [data-motion='pulse'] {
      animation: lxpulse 1.6s ease-in-out infinite !important;
    }
  }
`}
`
