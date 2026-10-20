import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin, ResolvedConfig } from 'vite';
import { checkConfigPath } from './options';
import { publicPath } from './rewrite';

export type { FetchaloConfig, FetchaloConfigExport } from './client-core';

const require = createRequire(import.meta.url);
const shimsPath = require.resolve('es-module-shims');
const shimsVersion: string = JSON.parse(
  readFileSync(path.join(path.dirname(shimsPath), '../package.json'), 'utf8')
).version;
const SHIMS_FILE = `assets/es-module-shims-${shimsVersion}.js`;
const CLIENT_FILE = fileURLToPath(new URL('./client.iife.js', import.meta.url));

/**
 * Loads JS, CSS and media from the config file's `origins` through `fetch`, with its
 * `headers`: e.g. remotes behind an `Authorization` header, on hosts where a service
 * worker is not available (plain HTTP). With Module Federation, also add
 * `fetchalo/federation` to the federation `runtimePlugins`.
 *
 * @param configPath The app's `fetchalo.config` file, e.g. `./src/fetchalo.config.ts`. It
 * runs in the browser before the app, so it must not import files from the `origins`.
 */
export function fetchalo(configPath: string): Plugin {
  checkConfigPath(configPath);
  let config: ResolvedConfig;
  // Only a browser build with HTML needs the client; SSR and library builds do not.
  const isClientBuild = () => config.command === 'build' && !config.build.ssr && !config.build.lib;
  const configFilePath = () => path.resolve(config.root, configPath);
  const shims = () => readFileSync(shimsPath, 'utf8');

  return {
    name: 'fetchalo',
    configResolved(resolvedConfig) {
      config = resolvedConfig;
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = req.url?.split('?')[0] ?? '';
        const served = config.base.startsWith('.')
          ? pathname.endsWith(`/${SHIMS_FILE}`)
          : pathname === `${config.base}${SHIMS_FILE}`;
        if (!served) return next();
        res.setHeader('Content-Type', 'application/javascript');
        res.end(shims());
      });
    },
    buildStart() {
      // Its own chunk: the app's module scripts can wait on requests to the origins
      // (e.g. Module Federation host init), which wait on the config.
      if (isClientBuild()) {
        this.emitFile({
          type: 'chunk',
          id: configFilePath(),
          name: 'fetchalo-config',
          // Vite drops the exports of app entries; the client needs the default export.
          preserveSignature: 'strict',
        });
      }
    },
    generateBundle() {
      if (isClientBuild()) {
        this.emitFile({ type: 'asset', fileName: SHIMS_FILE, source: shims() });
      }
    },
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        const configChunk = ctx.bundle
          ? Object.values(ctx.bundle).find(
              (chunk) => chunk.type === 'chunk' && chunk.facadeModuleId === configFilePath()
            )
          : undefined;
        const configFile = configChunk
          ? configChunk.fileName
          : path.relative(config.root, configFilePath()).replaceAll('\\', '/');
        const client = readFileSync(CLIENT_FILE, 'utf8').replace(
          '__FETCHALO_CONFIG__',
          JSON.stringify(publicPath(config.base, ctx.path, configFile))
        );
        // The scripts carry the page's CSP nonce, when Vite has one.
        const nonce = config.html?.cspNonce;
        const attrs = nonce ? { nonce } : {};
        return [
          { tag: 'script', attrs, children: client, injectTo: 'head-prepend' },
          {
            tag: 'script',
            attrs: { ...attrs, src: publicPath(config.base, ctx.path, SHIMS_FILE) },
            injectTo: 'head-prepend',
          },
        ];
      },
    },
  };
}

export default fetchalo;
