import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  define: {
    // Vite only exposes VITE_* variables to browser code. This non-sensitive
    // build label lets Preview expose safe ErrorBoundary diagnostics while
    // Production continues to show only the public recovery message.
    'import.meta.env.VERCEL_ENV': JSON.stringify(process.env.VERCEL_ENV || ''),
  },
  build: { outDir: 'dist', sourcemap: false }
})
