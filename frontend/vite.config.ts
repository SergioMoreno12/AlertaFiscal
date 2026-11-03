import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// En desarrollo el frontend llama a /api y /health en el mismo origen y Vite
// redirige al backend (evita CORS). En producción se usa VITE_API_BASE_URL.
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
    build: {
      outDir: 'dist',
      sourcemap: false,
    },
  }
})
