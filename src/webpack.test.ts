import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rspack } from '@rspack/core';
import { describe, expect, it } from 'vitest';
import webpack from 'webpack';
import { FetchaloPlugin } from '../dist/webpack.js';

const fixture = fileURLToPath(new URL('../test/fixture-webpack', import.meta.url));

async function bundle(bundler: typeof webpack | typeof rspack, entry: unknown): Promise<string> {
  const outDir = await mkdtemp(path.join(tmpdir(), 'fetchalo-webpack-'));
  try {
    await new Promise<void>((resolve, reject) => {
      (bundler as (options: unknown, callback: (error: Error | null, stats?: any) => void) => void)(
        {
          context: fixture,
          mode: 'development',
          devtool: false,
          entry: entry as never,
          output: { path: outDir, filename: '[name].js' },
          plugins: [
            new FetchaloPlugin({
              origins: ['https://remote.example/'],
              headers: './src/headers.js',
            }),
          ],
        } as never,
        (error, stats) => {
          if (error) return reject(error);
          if (stats?.hasErrors()) return reject(new Error(stats.toString('errors-only')));
          // No "Critical dependency" warnings: es-module-shims stays unparsed.
          if (stats?.hasWarnings()) return reject(new Error(stats.toString('errors-warnings')));
          resolve();
        }
      );
    });
    return readFileSync(path.join(outDir, 'main.js'), 'utf8');
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
}

// The bundle holds the client with the origins, the app's headers module and
// es-module-shims. Evaluation order is checked on the entry (below) and end to end.
function check(code: string) {
  expect(code).toContain('["https://remote.example"]');
  expect(code).not.toContain('__FETCHALO_ORIGINS__');
  expect(code).toContain('ES Module Shims @version');
  expect(code).toContain('Bearer test-token');
  expect(code).toContain('webpack app');
}

function fakeCompiler(entry: unknown) {
  const defines: Record<string, string>[] = [];
  return {
    defines,
    compiler: {
      context: fixture,
      options: {
        entry,
        resolve: {} as Record<string, unknown>,
        module: {} as Record<string, unknown>,
      },
      webpack: {
        DefinePlugin: class {
          constructor(definitions: Record<string, string>) {
            defines.push(definitions);
          }
          apply() {}
        },
      },
    },
  };
}

describe('FetchaloPlugin', () => {
  it('prepends the client and es-module-shims to a webpack entry', async () => {
    check(await bundle(webpack, './src/index.js'));
  });

  it('works with object entries and Rspack', async () => {
    check(await bundle(rspack, { main: { import: ['./src/index.js'] } }));
  });

  it('prepends its entry to every entry shape, defines the origins and aliases the headers', () => {
    const plugin = new FetchaloPlugin({
      origins: ['https://remote.example/'],
      headers: './src/headers.js',
    });
    const shapes: [unknown, (entry: any) => string[]][] = [
      ['./src/index.js', (entry) => entry],
      [['./src/a.js', './src/b.js'], (entry) => entry],
      [{ main: './src/index.js', other: ['./src/o.js'] }, (entry) => entry.main],
      [{ main: { import: ['./src/index.js'], dependOn: 'x' } }, (entry) => entry.main.import],
    ];
    for (const [entry, pick] of shapes) {
      const { compiler, defines } = fakeCompiler(entry);
      plugin.apply(compiler);
      const imports = pick(compiler.options.entry);
      expect(imports[0]).toMatch(/[\\/]dist[\\/]webpack-entry\.js$/);
      expect(imports.length).toBeGreaterThan(1);
      expect(defines).toEqual([{ __FETCHALO_ORIGINS__: '["https://remote.example"]' }]);
      expect((compiler.options.resolve.alias as Record<string, string>)['fetchalo/headers$']).toBe(
        path.join(fixture, 'src/headers.js')
      );
      const noParse = (compiler.options as any).module.noParse as RegExp;
      expect(noParse.test('/x/node_modules/es-module-shims/dist/es-module-shims.js')).toBe(true);
      expect(noParse.test('/x/node_modules/other/dist/es-module-shims.js')).toBe(false);
    }
    const { compiler } = fakeCompiler({ main: { import: ['./src/index.js'], dependOn: 'x' } });
    plugin.apply(compiler);
    expect((compiler.options.entry as any).main.dependOn).toBe('x');
  });

  it('wraps a function entry', async () => {
    const plugin = new FetchaloPlugin({
      origins: ['https://remote.example'],
      headers: './src/headers.js',
    });
    const { compiler } = fakeCompiler(async () => ({ main: './src/index.js' }));
    plugin.apply(compiler);
    const entry = await (compiler.options.entry as () => Promise<any>)();
    expect(entry.main[0]).toMatch(/webpack-entry\.js$/);
    expect(entry.main[1]).toBe('./src/index.js');
  });

  it('rejects invalid origins', () => {
    expect(() => new FetchaloPlugin({ origins: ['remote.example'], headers: './h.js' })).toThrow(
      'invalid origin'
    );
  });
});
