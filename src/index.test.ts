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

describe('fetchalo', () => {
  it('injects the client and es-module-shims, with the config file served by Vite in dev', () => {
    const plugin = fetchalo('./src/fetchalo.config.js') as any;
    plugin.configResolved({ root: fixture, base: '/', command: 'serve' });

    const [client, shims] = plugin.transformIndexHtml.handler('', { path: '/index.html' });

    expect(client.injectTo).toBe('head-prepend');
    expect(client.children).toContain('import("/src/fetchalo.config.js")');
    expect(client.children).toContain('loadConfig(module.default)');
    expect(client.children).not.toContain('__FETCHALO_');
    expect(shims.attrs.src).toMatch(/^\/assets\/es-module-shims-\d+\.\d+\.\d+\.js$/);
  });

  it('serves es-module-shims from the dev server', () => {
    const plugin = fetchalo('./src/fetchalo.config.js') as any;
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

  it('builds the config file as its own chunk that keeps its default export', async () => {
    const outDir = await mkdtemp(path.join(tmpdir(), 'fetchalo-'));
    try {
      await build({
        root: fixture,
        logLevel: 'silent',
        build: { outDir, emptyOutDir: true },
        plugins: [fetchalo('./src/fetchalo.config.js')],
      });

      const html = readFileSync(path.join(outDir, 'index.html'), 'utf8');
      const assets = await readdir(path.join(outDir, 'assets'));
      const configFile = assets.find((file) => file.startsWith('fetchalo-config-'));
      const shimsFile = assets.find((file) => file.startsWith('es-module-shims-'));

      expect(configFile).toBeDefined();
      expect(shimsFile).toBeDefined();
      expect(html).toMatch(new RegExp(`import\\(\\s*"/assets/${configFile}"`));
      expect(html).toContain(`<script src="/assets/${shimsFile}"></script>`);
      // The client and es-module-shims come before the app's module script.
      expect(html.indexOf('installFetchalo')).toBeLessThan(html.indexOf('type="module"'));
      const configChunk = readFileSync(path.join(outDir, 'assets', configFile!), 'utf8');
      expect(configChunk).toMatch(/export\s*\{\s*\w+ as default\s*\}/);
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });
});

describe('fetchalo options', () => {
  it('rejects an argument that is not a path', () => {
    expect(() => fetchalo({ config: './x.js' } as never)).toThrow(
      'pass the path of the config file'
    );
  });

  it('adds the CSP nonce and resolves a relative base from the page', () => {
    const plugin = fetchalo('./src/fetchalo.config.js') as any;
    plugin.configResolved({
      root: fixture,
      base: './',
      command: 'serve',
      html: { cspNonce: 'n0nce' },
    });
    const [client, shims] = plugin.transformIndexHtml.handler('', { path: '/nested/index.html' });
    expect(client.attrs).toEqual({ nonce: 'n0nce' });
    expect(client.children).toContain('"../src/fetchalo.config.js"');
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
        plugins: [fetchalo('./src/fetchalo.config.js')],
      });
      const files = await readdir(outDir, { recursive: true });
      expect(files.some((file) => /es-module-shims|fetchalo-config/.test(String(file)))).toBe(
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
    await expect(plugin.fetch('https://other.example/mf-manifest.json')).resolves.toBe(undefined);
    vi.unstubAllGlobals();
  });

  it('waits for the config origins before deciding what to load', async () => {
    const remoteExports = { init: () => {} };
    const origins = new Set<string>();
    let addOrigins!: () => void;
    const ready = new Promise<void>((resolve) => {
      addOrigins = () => {
        origins.add('https://remote.example');
        resolve();
      };
    });
    const fetchaloFetch = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetchalo', {
      fetch: fetchaloFetch,
      isTarget: (url: string) => origins.has(new URL(url).origin),
      ready,
    });
    vi.stubGlobal(
      'importShim',
      vi.fn(async () => remoteExports)
    );
    const plugin = fetchaloFederation();

    const entry = plugin.loadEntry({ remoteInfo: { ...remoteInfo, type: 'module' } });
    const manifest = plugin.fetch('https://remote.example/mf-manifest.json', {});
    addOrigins();

    await expect(entry).resolves.toBe(remoteExports);
    await manifest;
    expect(fetchaloFetch).toHaveBeenCalledWith('https://remote.example/mf-manifest.json', {});
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

  it('installs nothing from a config without a page (SSR)', async () => {
    const plugin = fetchaloFederation({
      origins: ['https://remote.example'],
      headers: () => ({ Authorization: 'Bearer test-token' }),
    });
    expect((globalThis as { fetchalo?: unknown }).fetchalo).toBeUndefined();
    await expect(plugin.loadEntry({ remoteInfo: { ...remoteInfo, type: 'module' } })).resolves.toBe(
      undefined
    );
  });

  it('keeps entries the runtime already loaded', async () => {
    const remoteEntryExports = {};
    await expect(fetchaloFederation().loadEntry({ remoteInfo, remoteEntryExports })).resolves.toBe(
      remoteEntryExports
    );
  });
});
