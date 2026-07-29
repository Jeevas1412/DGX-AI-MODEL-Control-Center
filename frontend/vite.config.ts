import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    host: '127.0.0.1',
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    // Source remains available in the GitHub repository; generated installers
    // do not need to embed source maps or their absolute development context.
    sourcemap: false,
  },
})
