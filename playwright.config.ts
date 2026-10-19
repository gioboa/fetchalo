import { defineConfig } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import path from 'node:path';

/**
 * End-to-end suite over the examples: the authenticated remote, loaded by the Vite,
 * webpack and Rspack hosts through fetchalo.
 *
 *   pnpm e2e
 */
export const REMOTE_REQUEST_LOG = path.resolve('reports/remote-requests.log');
mkdirSync(path.dirname(REMOTE_REQUEST_LOG), { recursive: true });

// A non-localhost address makes the page an insecure context, as on a plain-HTTP
// LAN host, where service workers are unavailable.
const lanAddress =
  Object.values(networkInterfaces())
    .flat()
    .find((address) => address?.family === 'IPv4' && !address.internal)?.address ?? '127.0.0.1';

const host = (port: number) => `http://${lanAddress}:${port}`;

export default defineConfig({
  testDir: 'e2e',
  timeout: 60 * 1000,
  retries: process.env.CI ? 2 : 0,
  // The tests share the remote's request log.
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  webServer: [
    {
      command: `REMOTE_REQUEST_LOG=${REMOTE_REQUEST_LOG} pnpm --filter fetchalo-example-remote run preview`,
      // Ready on any status below 404, so the 401 without the token counts.
      url: 'http://localhost:5176/mf-manifest.json',
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
    {
      command: 'pnpm --filter fetchalo-example-vite-host run preview',
      url: 'http://localhost:5175',
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
    {
      command: 'pnpm --filter fetchalo-example-bundler-host run start:webpack',
      url: 'http://localhost:8084',
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
    {
      command: 'pnpm --filter fetchalo-example-bundler-host run start:rspack',
      url: 'http://localhost:8085',
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
  use: {
    // The trace recorder re-requests resources without the token, which would show
    // up as 401s in the remote's request log.
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'vite-chromium', use: { baseURL: host(5175), browserName: 'chromium' } },
    { name: 'vite-firefox', use: { baseURL: host(5175), browserName: 'firefox' } },
    { name: 'vite-webkit', use: { baseURL: host(5175), browserName: 'webkit' } },
    { name: 'webpack-chromium', use: { baseURL: host(8084), browserName: 'chromium' } },
    { name: 'rspack-chromium', use: { baseURL: host(8085), browserName: 'chromium' } },
  ],
  outputDir: 'reports/e2e-output',
  reporter: [['list'], ['html', { outputFolder: 'reports/playwright-report', open: 'never' }]],
});
