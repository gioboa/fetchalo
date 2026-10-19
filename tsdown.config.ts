import { defineConfig } from 'tsdown';

export default defineConfig([
  {
    entry: ['src/index.ts', 'src/federation.ts', 'src/webpack.ts'],
    format: ['esm'],
    outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
    dts: true,
    clean: true,
    sourcemap: true,
  },
  {
    // The webpack/Rspack entry: bundled by the app's bundler, which also resolves
    // `fetchalo/headers` (alias) and `es-module-shims`.
    // Two chunks on purpose: the setup must run before es-module-shims evaluates,
    // and a single module would hoist both imports above the setup code.
    entry: ['src/webpack-entry.ts', 'src/webpack-setup.ts'],
    format: ['esm'],
    outExtensions: () => ({ js: '.js' }),
    external: ['fetchalo/headers', 'es-module-shims'],
    dts: false,
    clean: false,
  },
  {
    // Injected into the page by the Vite plugin as a classic script: not minified,
    // so the plugin can fill in its placeholders.
    entry: { client: 'src/client.ts' },
    format: ['iife'],
    dts: false,
    clean: false,
    minify: false,
  },
]);
