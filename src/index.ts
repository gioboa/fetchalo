import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin, ResolvedConfig } from 'vite';
import { normalizeOrigins, publicPath } from './rewrite';

export type FetchaloOptions = {
  /** Origins whose files are fetched with the headers, e.g. `https://remote.example`. */
  origins: string[];
  /**
   * Module whose default export returns the headers for a URL:
   * `(url) => HeadersInit | Promise<HeadersInit>`. Called for every request, so it can
   * return a refreshed token. It is loaded before the app, so it must not import
   * files from the `origins`.
   */
  headers: string;
};

const require = createRequire(import.meta.url);
const shimsPath = require.resolve('es-module-shims');
const shimsVersion: string = JSON.parse(
  readFileSync(path.join(path.dirname(shimsPath), '../package.json'), 'utf8')
).version;
const SHIMS_FILE = `assets/es-module-shims-${shimsVersion}.js`;
const CLIENT_FILE = fileURLToPath(new URL('./client.iife.js', import.meta.url));

/**
 * Loads JS, CSS and media from `origins` through `fetch`, with the headers from the
 * `headers` module: e.g. remotes behind an `Authorization` header, on hosts where a
 * service worker is not available (plain HTTP). With Module Federation, also add
 * `fetchalo/federation` to the federation `runtimePlugins`.
 */
export function fetchalo(options: FetchaloOptions): Plugin {
  const origins = normalizeOrigins(options.origins);
  const headers = options.headers;
  let config: ResolvedConfig;
  // Only a browser build with HTML needs the client; SSR and library builds do not.
  const isClientBuild = () => config.command === 'build' && !config.build.ssr && !config.build.lib;
  const headersPath = () => path.resolve(config.root, headers);
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
      // (e.g. Module Federation host init), which wait on the headers.
      if (isClientBuild()) {
        this.emitFile({
          type: 'chunk',
          id: headersPath(),
          name: 'fetchalo-headers',
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
        const headersChunk = ctx.bundle
          ? Object.values(ctx.bundle).find(
              (chunk) => chunk.type === 'chunk' && chunk.facadeModuleId === headersPath()
            )
          : undefined;
        const headersFile = headersChunk
          ? headersChunk.fileName
          : path.relative(config.root, headersPath()).replaceAll('\\', '/');
        const client = readFileSync(CLIENT_FILE, 'utf8')
          .replace('__FETCHALO_ORIGINS__', JSON.stringify(origins))
          .replace(
            '__FETCHALO_HEADERS__',
            JSON.stringify(publicPath(config.base, ctx.path, headersFile))
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
