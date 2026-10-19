import { federation } from '@module-federation/vite';
import react from '@vitejs/plugin-react';
import { fetchalo } from 'fetchalo';
import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5175, strictPort: true },
  preview: { port: 5175, strictPort: true },
  plugins: [
    // Every request to the origins in src/fetchalo.config.js carries its headers.
    fetchalo('./src/fetchalo.config.js'),
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
      // Loads the manifest and the remote entry through fetchalo.
      runtimePlugins: ['fetchalo/federation'],
    }),
  ],
  build: { target: 'chrome91' },
});
