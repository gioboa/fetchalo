import { federation } from '@module-federation/vite';
import react from '@vitejs/plugin-react';
import { appendFileSync } from 'node:fs';
import { defineConfig } from 'vite';

export const TOKEN = 'Bearer fetchalo-demo-token';

// Serves the remote's files only with the token (the hosts' remoteHeaders.js adds
// it). Every request is logged to REMOTE_REQUEST_LOG when set, for the e2e suite.
function requireAuth() {
  const check = (req, res, next) => {
    const ok = req.method === 'OPTIONS' || req.headers.authorization === TOKEN;
    if (process.env.REMOTE_REQUEST_LOG) {
      const dest = req.headers['sec-fetch-dest'] ?? '';
      appendFileSync(
        process.env.REMOTE_REQUEST_LOG,
        `${req.method} ${req.url} ${ok ? 200 : 401} ${dest}\n`
      );
    }
    if (ok) return next();
    res.statusCode = 401;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.end();
  };
  return {
    name: 'require-auth',
    configureServer: (server) => void server.middlewares.use(check),
    configurePreviewServer: (server) => void server.middlewares.use(check),
  };
}

export default defineConfig({
  base: 'http://localhost:5176/',
  server: { port: 5176, strictPort: true, cors: true },
  // Hosts may run on another origin (e.g. a LAN address): answer their CORS preflights.
  preview: { port: 5176, strictPort: true, cors: true },
  plugins: [
    requireAuth(),
    react(),
    federation({
      name: 'remote',
      filename: 'remoteEntry.js',
      dts: false,
      manifest: true,
      exposes: {
        './App': './src/App.jsx',
        './Assets': './src/Assets.jsx',
      },
      // styled-components stays bundled: shared as a singleton that a webpack/Rspack
      // host does not provide, the container's init() fails (React resolves to
      // undefined in the remote's share wrapper).
      shared: {
        react: { singleton: true },
        'react-dom': { singleton: true },
      },
    }),
  ],
  build: {
    target: 'chrome91',
    // Keep every asset a URL (nothing inlined), so the hosts really fetch them.
    assetsInlineLimit: 0,
  },
});
