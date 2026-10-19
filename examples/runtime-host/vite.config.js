import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// No build plugins for fetchalo or federation: src/main.jsx registers both at runtime.
export default defineConfig({
  server: { port: 5178, strictPort: true },
  preview: { port: 5178, strictPort: true },
  plugins: [react()],
  build: { target: 'chrome91' },
});
