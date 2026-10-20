import { federation } from '@module-federation/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5179, strictPort: true },
  preview: { port: 5179, strictPort: true },
  plugins: [
    react(),
    federation({
      name: 'host',
      dts: false,
      remotes: {
        remote1: {
          name: 'remote1',
          entry: 'http://localhost:5176/mf-manifest.json',
          type: 'module',
        },
      },
      shared: {
        react: { singleton: true },
        'react-dom': { singleton: true },
      },
      // Installs fetchalo with its origins and headers: no fetchalo build plugin.
      runtimePlugins: ['./src/fetchalo.plugin.js'],
    }),
  ],
  build: { target: 'chrome91' },
});
