import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Everything is bundled locally: the booth has no reliable internet (Logistical Q&A).
export default defineConfig({
  plugins: [react()],
  base: './',
  server: { port: 5173, strictPort: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
});
