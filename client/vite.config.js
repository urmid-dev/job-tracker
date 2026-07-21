import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Same-origin from the browser's perspective in dev too — matches
    // production (where Express serves the built client directly) and avoids
    // cross-origin cookie issues for the auth session.
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
})
