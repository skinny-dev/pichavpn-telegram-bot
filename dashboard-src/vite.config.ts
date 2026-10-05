import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// Build goes straight into ../dashboard (next to api.php). emptyOutDir=false keeps api.php.
export default defineConfig({
  plugins: [react()],
  base: './',
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  build: { outDir: '../dashboard', emptyOutDir: false, assetsDir: 'assets', chunkSizeWarningLimit: 900 },
  server: { proxy: { '/dashboard/api.php': { target: 'http://127.0.0.1:8099', changeOrigin: true } } },
  test: { environment: 'jsdom', globals: true },
})
