# fetchalo

> *fetchalo*: Italian for "fetch it!".

Vite, webpack and Rspack plugin, and Module Federation runtime plugin, that loads JS, CSS and media from the origins you choose **through your own `fetch`**, so every request can carry headers such as `Authorization`, without a service worker.

Browsers cannot add headers to `<script type="module">`, `import()`, `<link>`, `<img>` or CSS `url()` requests. Service workers can, but only in a secure context (HTTPS or `localhost`) and one per scope. fetchalo works on plain-HTTP hosts too, for example micro-frontend remotes on a LAN behind an API key.

## Install

```sh
npm install fetchalo
```

Peer dependencies (all optional): `vite` 5-8, `webpack` 5 or `@rspack/core`.

## Usage

Pick the setup for your host:

- **Module Federation runtime API** (the host creates its federation instance with `createInstance`): register the `fetchalo/federation` runtime plugin. No build configuration.
- **Vite**, **webpack or Rspack** for every other host: a page without Module Federation, or remotes declared in the build configuration (`federation({ remotes })`). The build plugin installs fetchalo before the app and reads the origins and headers from a [`fetchalo.config.js`](#fetchaloconfigjs) file. With Vite, remotes declared in the build configuration can also [use `runtimePlugins` alone](#vite).

### Module Federation runtime API

```ts
import { createInstance } from '@module-federation/enhanced/runtime';
import fetchaloFederation from 'fetchalo/federation';

const mf = createInstance({
  name: 'host',
  remotes: [],
  plugins: [
    fetchaloFederation({
      origins: [apiOrigin],
      headers: (url) => ({ Authorization: `Bearer ${getToken()}` }),
    }),
  ],
});
```

The plugin installs fetchalo and es-module-shims in the page; the remotes' manifests, `module`/`esm` entries, chunks, CSS and media then load through it. `mf.registerPlugins([fetchaloFederation({ ... })])` works too, before the first remote loads. The argument can also be a promise of `{ origins, headers }`, for origins resolved at runtime. Several instances share the first installation.

In a webpack or Rspack host, use the [webpack plugin](#webpack-and-rspack) instead: it keeps the bundler from parsing es-module-shims.

### Vite

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import { fetchalo } from 'fetchalo';

export default defineConfig({
  plugins: [fetchalo('./src/fetchalo.config.ts')],
});
```

With remotes in `@module-federation/vite`, also add `fetchalo/federation`, without an argument, to `runtimePlugins`:

```ts
federation({
  name: 'host',
  remotes: {
    remote: { name: 'remote', entry: 'https://remote.example/mf-manifest.json', type: 'module' },
  },
  runtimePlugins: ['fetchalo/federation'],
});
```

Alternatively, install fetchalo through `runtimePlugins` alone, without the vite plugin: list a file of your own that returns `fetchalo/federation` with the origins and headers.

```ts
// src/fetchalo.plugin.ts
import fetchaloFederation from 'fetchalo/federation';

export default () =>
  fetchaloFederation({
    origins: ['https://remote.example'],
    headers: (url) => ({ Authorization: `Bearer ${getToken()}` }),
  });
```

```ts
federation({
  name: 'host',
  remotes: {
    remote: { name: 'remote', entry: 'https://remote.example/mf-manifest.json', type: 'module' },
  },
  runtimePlugins: ['./src/fetchalo.plugin.ts'],
});
```

fetchalo is then installed when the federation runtime starts, before it loads the remotes. Files on the origins that the app requests before then are not covered.

### webpack and Rspack

```js
// webpack.config.js (or rspack.config.js with 'fetchalo/rspack')
const { FetchaloPlugin } = require('fetchalo/webpack');

module.exports = {
  plugins: [new FetchaloPlugin('./src/fetchalo.config.js')],
};
```

The plugin prepends the client, the config file and es-module-shims to every entry, so they run before the app. With Module Federation, add `fetchalo/federation` to `runtimePlugins` as with Vite.

### fetchalo.config.js

The build plugins take the path of this file (`.js` or `.ts`) and load it in the browser before the app. Its default export is the `origins` whose files get the headers, and the `headers` function, called for every request so it can return a refreshed token:

```ts
// src/fetchalo.config.ts
import type { FetchaloConfig } from 'fetchalo';

export default {
  origins: ['https://remote.example'],
  headers: async (url) => ({ Authorization: `Bearer ${await getToken()}` }),
} satisfies FetchaloConfig;
```

It must not import files from the `origins`. It is bundled with the app, so it can read build-time values itself (`import.meta.env` with Vite, DefinePlugin constants with webpack/Rspack). For values computed in the browser, export a function that returns the config, or a promise of it:

```ts
export default async (): Promise<FetchaloConfig> => ({
  // e.g. remotes on the host's own domain, or a whitelist from your server
  origins: await fetch('/api/remote-origins').then((res) => res.json()),
  headers: (url) => ({ Authorization: `Bearer ${getToken()}` }),
});
```

### CORS

The remote server must answer the CORS preflight for the header: `Access-Control-Allow-Origin` and `Access-Control-Allow-Headers: Authorization`.

## API

```ts
// fetchalo/federation: installs fetchalo when given a config; without one, uses the
// fetchalo that a build plugin installed.
fetchaloFederation(config?: FetchaloConfig | Promise<FetchaloConfig>);

// Build plugins: the path of the fetchalo.config file.
fetchalo(configPath: string); // Vite
new FetchaloPlugin(configPath: string); // webpack/Rspack

// The fetchalo.config file's default export:
export default FetchaloConfig | (() => FetchaloConfig | Promise<FetchaloConfig>);

type FetchaloConfig = {
  origins: string[]; // origins whose files get the headers
  headers: (url: string) => HeadersInit | undefined | Promise<HeadersInit | undefined>;
};
```

Until a config given as a promise resolves, nothing is fetched through fetchalo: requests wait for it, and `window.fetchalo.ready` resolves when it has. Elements the app adds to the page before then are not covered.

## What goes through your fetch

For files on the config's `origins`:

| Request | How |
| --- | --- |
| JS modules: entries, static imports, `import()` | [es-module-shims](https://github.com/guybedford/es-module-shims) in shim mode, with its `fetch` hook |
| Module Federation manifests and remote entries | `fetchalo/federation` runtime plugin |
| `<link rel="stylesheet">` (e.g. Vite's CSS preload) and their `@import`s | fetched, served from `blob:` URLs |
| `url()` in those stylesheets, `<style>` text, CSSOM rules (CSS-in-JS) and inline styles | rewritten to `blob:` URLs |
| `<img>`, `<source>`, `<video>`, `<audio>`: `src`, `srcset`, `poster` | fetched, served from `blob:` URLs |

`<link rel="modulepreload|preload|prefetch">` hints to those origins are dropped: es-module-shims fetches the modules, other files are fetched when used. If the app already configures es-module-shims (`esmsInitOptions`), its options are kept and its `fetch` hook still runs.

## Limits

- Browser only: no SSR.
- Not covered: elements written in the page's HTML (the parser creates them without the patched DOM methods; only their `url()`s in `<style>` and `style` attributes are rewritten), SVG `<image>`, `<iframe>`, `<object>`, workers, `adoptedStyleSheets`, elements created with `innerHTML`, and `fetch()` calls made by the loaded code itself.
- Media is downloaded whole into a `blob:` URL: no streaming or range requests. `blob:` URLs are kept for the page's lifetime.
- It patches DOM prototypes (`appendChild`, `setAttribute`, `insertRule`, media setters) for the config's origins only.
- The Vite plugin's injected script is inline: with a strict CSP, set Vite's `html.cspNonce` and the scripts carry it.
- With Module Federation, only `module`/`esm` remotes from built output; `var` remotes load through `<script>` tags.

## How it works

1. Module Federation runtime API: `fetchaloFederation(config)` installs the client when it is created, then loads es-module-shims. Vite: the plugin injects a classic script and es-module-shims at the top of `<head>`, and builds your config file as a separate chunk, so it never waits on the app. webpack/Rspack: the plugin prepends the client, your config file and es-module-shims to every entry.
2. Every request to the config's `origins` goes through `fetch` with its headers, and the browser gets the files from `blob:` URLs.

## Examples

[`examples/`](./examples) has a complete setup, which the e2e suite (`pnpm e2e`) runs in Chromium, Firefox and WebKit:

- [`remote`](./examples/remote): a Vite + Module Federation remote that serves its files only with an `Authorization` header. Its exposes use images, `srcset`, video, inline styles, CSS-in-JS backgrounds and fonts, and a stylesheet with an `@import`.
- [`vite-host`](./examples/vite-host): a Vite host with the `fetchalo` build plugin and `fetchalo/federation` in `runtimePlugins`.
- [`vite-runtime-plugin-host`](./examples/vite-runtime-plugin-host): the same Vite host, with fetchalo installed only through `runtimePlugins`.
- [`runtime-host`](./examples/runtime-host): a host without build plugins: it registers the remote and `fetchalo/federation` with the Module Federation runtime API, and resolves the remote's origin at runtime.
- [`bundler-host`](./examples/bundler-host): the same host with webpack (`fetchalo/webpack`) and Rspack (`fetchalo/rspack`).

```sh
pnpm install
pnpm build
pnpm --filter fetchalo-example-remote run preview      # http://localhost:5176, 401 without the token
pnpm --filter fetchalo-example-vite-host run preview   # http://localhost:5175
pnpm --filter fetchalo-example-vite-runtime-plugin-host run preview   # http://localhost:5179
pnpm --filter fetchalo-example-runtime-host run preview   # http://localhost:5178
pnpm --filter fetchalo-example-bundler-host run start:webpack   # http://localhost:8084
pnpm --filter fetchalo-example-bundler-host run start:rspack    # http://localhost:8085
```

## Build this package

```sh
pnpm install
pnpm test       # unit tests (builds first)
pnpm e2e        # examples in real browsers
pnpm packcheck
```
