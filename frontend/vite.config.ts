import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Proxies /api/* to the FastAPI backend so the frontend can just call
// relative paths — no CORS config or hardcoded backend port to keep in
// sync, and it matches how a built/served version of this app would also
// sit behind the same origin as the API in a simple single-machine setup.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
})
