import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

// Vitest config for lunes-dex-main.
//
// NOTE: this repo historically targeted Jest (see CLAUDE.md "none configured
// yet"), but the app is built on Vite 6 — Vitest reuses the same transform
// pipeline, so the styled-components / recharts ESM deps load with no extra
// config. Tests are pure-logic only (no Polkadot, no network, no node RPC).
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      components: path.resolve(__dirname, 'src/components'),
      context: path.resolve(__dirname, 'src/context'),
      hooks: path.resolve(__dirname, 'src/hooks'),
      pages: path.resolve(__dirname, 'src/pages'),
      services: path.resolve(__dirname, 'src/services'),
      styles: path.resolve(__dirname, 'src/styles'),
      utils: path.resolve(__dirname, 'src/utils'),
      theme: path.resolve(__dirname, 'src/theme'),
      routers: path.resolve(__dirname, 'src/routers'),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    // Keep the suite hermetic — no global setup, no network, no chain.
    restoreMocks: true,
  },
})
