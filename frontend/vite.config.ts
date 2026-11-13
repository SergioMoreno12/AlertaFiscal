/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// In development the frontend calls /api and /health on the same origin and Vite
// forwards them to the backend (avoids CORS). In production VITE_API_BASE_URL is used.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')
  const proxyTarget = env.VITE_API_PROXY_TARGET || 'http://localhost:5000'

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/api': { target: proxyTarget, changeOrigin: true },
        '/health': { target: proxyTarget, changeOrigin: true },
      },
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
    },
    build: {
      outDir: 'dist',
      sourcemap: false,
    },
  }
})
