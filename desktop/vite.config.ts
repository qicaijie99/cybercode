import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

const host = process.env.TAURI_DEV_HOST || '127.0.0.1'
const port = Number.parseInt(process.env.VITE_DEV_PORT || '1420', 10)
const hmrPort = Number.parseInt(process.env.VITE_HMR_PORT || '1421', 10)

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  // Vite options tailored for Tauri development
  clearScreen: false,
  server: {
    port,
    strictPort: true,
    host,
    hmr: { protocol: 'ws', host, port: hmrPort },
    watch: {
      ignored: ['**/src-tauri/**'],
    },
    fs: {
      allow: ['..'],
    },
  },
})
