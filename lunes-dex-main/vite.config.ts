import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig(({ mode }) => {
  // Load .env files
  const env = loadEnv(mode, process.cwd(), 'REACT_APP_')

  // Build process.env.REACT_APP_* definitions for backwards compatibility
  // This allows all existing code to keep using process.env.REACT_APP_XXX unchanged
  const processEnvDefines: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    processEnvDefines[`process.env.${key}`] = JSON.stringify(value)
  }

  return {
    plugins: [react()],

    resolve: {
      alias: {
        // Mirror CRA's "baseUrl": "src" from tsconfig.json
        components: path.resolve(__dirname, 'src/components'),
        context: path.resolve(__dirname, 'src/context'),
        hooks: path.resolve(__dirname, 'src/hooks'),
        pages: path.resolve(__dirname, 'src/pages'),
        services: path.resolve(__dirname, 'src/services'),
        styles: path.resolve(__dirname, 'src/styles'),
        utils: path.resolve(__dirname, 'src/utils'),
        theme: path.resolve(__dirname, 'src/theme'),
        routers: path.resolve(__dirname, 'src/routers')
      }
    },

    define: {
      // Backwards-compatible process.env.REACT_APP_* support
      ...processEnvDefines,
      // Some libs check for process.env.NODE_ENV
      'process.env.NODE_ENV': JSON.stringify(mode)
    },

    server: {
      port: 3000,
      open: true
    },

    build: {
      outDir: 'build', // Match CRA output dir
      sourcemap: mode !== 'production'
    },

    esbuild: {
      drop: mode === 'production' ? ['console', 'debugger'] : []
    }
  }
})
