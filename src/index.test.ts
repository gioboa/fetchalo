import { readFileSync } from 'node:fs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { describe, expect, it, vi } from 'vitest';
// The plugin reads the built client next to it: `pnpm test` builds first.
import fetchaloFederation from '../dist/federation.js';
import { fetchalo } from '../dist/index.js';

const fixture = fileURLToPath(new URL('../test/fixture', import.meta.url));
const origins = ['https://remote.example'];

describe('fetchalo', () => {
  it('injects the client and es-module-shims, with the headers module served by Vite in dev', () => {
    const plugin = fetchalo({ origins, headers: './src/headers.js' }) as any;
    plugin.configResolved({ root: fixture, base: '/', command: 'serve' });

    const [client, shims] = plugin.transformIndexHtml.handler('', { path: '/index.html' });

    expect(client.injectTo).toBe('head-prepend');
    expect(client.children).toContain('origins: ["https://remote.example"]');
    expect(client.children).toContain('"/src/headers.js"');
    expect(client.children).not.toContain('__FETCHALO_');
    expect(shims.attrs.src).toMatch(/^\/assets\/es-module-shims-\d+\.\d+\.\d+\.js$/);
  });

  it('serves es-module-shims from the dev server', () => {
    const plugin = fetchalo({ origins, headers: './src/headers.js' }) as any;
    plugin.configResolved({ root: fixture, base: '/', command: 'serve' });
    const [, shims] = plugin.transformIndexHtml.handler('', { path: '/index.html' });
    let middleware: any;
    plugin.configureServer({ middlewares: { use: (fn: any) => (middleware = fn) } });

    const res = { setHeader: vi.fn(), end: vi.fn() };
    const next = vi.fn();
    middleware({ url: `${shims.attrs.src}?v=1` }, res, next);
    middleware({ url: '/other.js' }, res, next);

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/javascript');
    expect(res.end.mock.calls[0][0]).toContain('importShim');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('builds the headers module as its own chunk that keeps its default export', async () => {
    const outDir = await mkdtemp(path.join(tmpdir(), 'fetchalo-'));
    try {
      await build({
        root: fixture,
        logLevel: 'silent',
        build: { outDir, emptyOutDir: true },
        plugins: [fetchalo({ origins, headers: './src/headers.js' })],
      });

      const html = readFileSync(path.join(outDir, 'index.html'), 'utf8');
      const assets = await readdir(path.join(outDir, 'assets'));
      const headersFile = assets.find((file) => file.startsWith('fetchalo-headers-'));
      const shimsFile = assets.find((file) => file.startsWith('es-module-shims-'));

      expect(headersFile).toBeDefined();
      expect(shimsFile).toBeDefined();
      expect(html).toMatch(new RegExp(`import\\(\\s*"/assets/${headersFile}"`));
      expect(html).toContain(`<script src="/assets/${shimsFile}"></script>`);
      // The client and es-module-shims come before the app's module script.
      expect(html.indexOf('origins: ["https://remote.example"]')).toBeLessThan(
        html.indexOf('type="module"')
      );
      const headersChunk = readFileSync(path.join(outDir, 'assets', headersFile!), 'utf8');
      expect(headersChunk).toMatch(/export\s*\{\s*\w+ as default\s*\}/);
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });
});

describe('fetchalo options', () => {
  it('normalizes origins to URL.origin', () => {
    const plugin = fetchalo({
      origins: [
        'https://remote.example/',
        'http://host.example:5176/testbase/',
        'https://remote.example',
      ],
      headers: './src/headers.js',
    }) as any;
    plugin.configResolved({ root: fixture, base: '/', command: 'serve' });
    const [client] = plugin.transformIndexHtml.handler('', { path: '/index.html' });
    expect(client.children).toContain(
      'origins: ["https://remote.example","http://host.example:5176"]'
    );
  });

  it('rejects missing or invalid origins', () => {
    expect(() => fetchalo({ origins: [], headers: './src/headers.js' })).toThrow('at least one');
    expect(() => fetchalo({ origins: ['remote.example'], headers: './src/headers.js' })).toThrow(
      'invalid origin "remote.example"'
    );
  });

  it('adds the CSP nonce and resolves a relative base from the page', () => {
    const plugin = fetchalo({ origins, headers: './src/headers.js' }) as any;
    plugin.configResolved({
      root: fixture,
      base: './',
      command: 'serve',
      html: { cspNonce: 'n0nce' },
    });
    const [client, shims] = plugin.transformIndexHtml.handler('', { path: '/nested/index.html' });
    expect(client.attrs).toEqual({ nonce: 'n0nce' });
    expect(client.children).toContain('"../src/headers.js"');
    expect(shims.attrs.nonce).toBe('n0nce');
    expect(shims.attrs.src).toMatch(/^\.\.\/assets\/es-module-shims-/);

    let middleware: any;
    plugin.configureServer({ middlewares: { use: (fn: any) => (middleware = fn) } });
    const res = { setHeader: vi.fn(), end: vi.fn() };
    middleware({ url: shims.attrs.src.replace('..', '') }, res, vi.fn());
    expect(res.end).toHaveBeenCalled();
  });

  it('emits nothing for an SSR build', async () => {
    const outDir = await mkdtemp(path.join(tmpdir(), 'fetchalo-ssr-'));
    try {
      await build({
        root: fixture,
        logLevel: 'silent',
        build: { outDir, emptyOutDir: true, ssr: 'src/main.js' },
        plugins: [fetchalo({ origins, headers: './src/headers.js' })],
      });
      const files = await readdir(outDir, { recursive: true });
      expect(files.some((file) => /es-module-shims|fetchalo-headers/.test(String(file)))).toBe(
        false
      );
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });
});

describe('fetchalo/federation', () => {
  const remoteInfo = { name: 'remote', entry: 'https://remote.example/remoteEntry.js' };

  it('loads module remotes on the fetchalo origins with importShim', async () => {
    const remoteExports = { init: () => {} };
    const fetchaloFetch = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetchalo', {
      fetch: fetchaloFetch,
      isTarget: (url: string) => url.startsWith('https://remote.example/'),
    });
    vi.stubGlobal(
      'importShim',
      vi.fn(async () => remoteExports)
    );
    const plugin = fetchaloFederation();

    await expect(plugin.loadEntry({ remoteInfo: { ...remoteInfo, type: 'module' } })).resolves.toBe(
      remoteExports
    );
    await expect(plugin.loadEntry({ remoteInfo: { ...remoteInfo, type: 'var' } })).resolves.toBe(
      undefined
    );
    await expect(
      plugin.loadEntry({
        remoteInfo: {
          name: 'other',
          entry: 'https://other.example/remoteEntry.js',
          type: 'module',
        },
      })
    ).resolves.toBe(undefined);

    await plugin.fetch('https://remote.example/mf-manifest.json', {});
    expect(fetchaloFetch).toHaveBeenCalledWith('https://remote.example/mf-manifest.json', {});
    expect(plugin.fetch('https://other.example/mf-manifest.json')).toBe(undefined);
    vi.unstubAllGlobals();
  });

  it('reports entry failures as RUNTIME-008, so the runtime can retry them', async () => {
    vi.stubGlobal('fetchalo', { fetch, isTarget: () => true });
    vi.stubGlobal(
      'importShim',
      vi.fn(async () => Promise.reject(new Error('401 denied')))
    );
    await expect(
      fetchaloFederation().loadEntry({ remoteInfo: { ...remoteInfo, type: 'module' } })
    ).rejects.toThrow(/#RUNTIME-008[\s\S]*401 denied/);
    vi.unstubAllGlobals();
  });

  it('keeps entries the runtime already loaded', async () => {
    const remoteEntryExports = {};
    await expect(fetchaloFederation().loadEntry({ remoteInfo, remoteEntryExports })).resolves.toBe(
      remoteEntryExports
    );
  });
});
