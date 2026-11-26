import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const apiTarget = process.env.VITE_API_PROXY_TARGET || 'http://localhost:3001'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
      },
      '/uploads': {
        target: apiTarget,
        changeOrigin: true,
      },
      '/pagar': {
        target: apiTarget,
        changeOrigin: true,
        bypass(req) {
          if (req.url && req.url.startsWith('/pagar/aviso/')) {
            return req.url
          }
          return null
        },
      },
    },
  },
})
