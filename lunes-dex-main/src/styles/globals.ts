import { createGlobalStyle, css } from 'styled-components'

export default createGlobalStyle`
${({ theme }) => css`
  @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&display=swap');

  * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
    font-family: 'Space Grotesk', sans-serif;
    scroll-behavior: smooth;
  }

  body {
    height: 100%;
    text-rendering: optimizelegibility !important;
    -webkit-font-smoothing: antialiased !important;
    color: ${theme.colors.themeColors[100]};
    background: ${theme.colors.themeColors[500]};
  }

  html {
    font-size: 62.5%;
  }

  html,
  body,
  #__next {
    height: 100%;
    overflow-x: hidden;
  }

  button {
    cursor: pointer;
    border: none;
    white-space: nowrap;
    font-family: 'Space Grotesk', sans-serif;
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    will-change: transform, box-shadow;

    :hover:not(:disabled) {
      transform: translateY(-1px) scale(1.02);
      box-shadow: 0 4px 16px rgba(108, 56, 255, 0.15);
      filter: brightness(1.05);
    }

    :active:not(:disabled) {
      transform: translateY(0) scale(0.98);
      box-shadow: none;
      transition-duration: 0.1s;
    }

    :disabled {
      opacity: 0.5;
      cursor: not-allowed;
      filter: none;
      transform: none;
    }
  }

  a {
    color: inherit;
    text-decoration: none;
    transition: color 0.15s ease;
  }

  /* Smooth focus ring */
  :focus-visible {
    outline: 2px solid #6C38FF;
    outline-offset: 2px;
  }

  ul {
    list-style: none;
  }

  /* Reduced motion support */
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important;
    }
  }

  /* Scrollbar Customization */
  ::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }

  ::-webkit-scrollbar-track {
    background: ${theme.colors.themeColors[600]};
    border-radius: 4px;
  }

  ::-webkit-scrollbar-thumb {
    background: ${theme.colors.themeColors[400]};
    border-radius: 4px;
    border: 2px solid ${theme.colors.themeColors[600]};
  }

  ::-webkit-scrollbar-thumb:hover {
    background: ${theme.colors.primary[500]};
  }

  /* Hide native number input spinners */
  input[type="number"]::-webkit-inner-spin-button,
  input[type="number"]::-webkit-outer-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }

  input[type="number"] {
    -moz-appearance: textfield;
    appearance: textfield;
  }
`}
`
