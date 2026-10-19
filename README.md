# fetchalo

> *fetchalo*: Italian for "fetch it!".

Vite, webpack and Rspack plugin that loads JS, CSS and media from the origins you choose **through your own `fetch`**, so every request can carry headers such as `Authorization`, without a service worker.

Browsers cannot add headers to `<script type="module">`, `import()`, `<link>`, `<img>` or CSS `url()` requests. Service workers can, but only in a secure context (HTTPS or `localhost`) and one per scope. fetchalo works on plain-HTTP hosts too, for example micro-frontend remotes on a LAN behind an API key.

## Install

```sh
npm install fetchalo
```

Peer dependencies (all optional): `vite` 5-8, `webpack` 5 or `@rspack/core`.

## Usage

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import { fetchalo } from 'fetchalo';

export default defineConfig({
  plugins: [
    fetchalo({
      origins: ['https://remote.example'],
      headers: './src/remoteHeaders.ts',
    }),
  ],
});
```

```ts
// src/remoteHeaders.ts
export default async function remoteHeaders(url: string) {
  return { Authorization: `Bearer ${await getToken()}` };
}
```

The headers function is called for every request, so it can return a refreshed token. It is loaded before the app, so it must not import files from the `origins`.

### webpack and Rspack

The same client as a webpack/Rspack plugin. It prepends itself and es-module-shims to every entry, so they run before the app:

```js
// webpack.config.js (or rspack.config.js with 'fetchalo/rspack')
const { FetchaloPlugin } = require('fetchalo/webpack');

module.exports = {
  plugins: [
    new FetchaloPlugin({
      origins: ['https://remote.example'],
      headers: './src/remoteHeaders.js',
    }),
  ],
};
```

The `headers` module is bundled with the app (as the alias `fetchalo/headers`); it must not import files from the `origins`.

### With Module Federation

Add the runtime plugin, so remote manifests and `module`/`esm` remote entries load through fetchalo too:

```ts
import { federation } from '@module-federation/vite';

federation({
  name: 'host',
  remotes: {
    remote: { name: 'remote', entry: 'https://remote.example/mf-manifest.json', type: 'module' },
  },
  runtimePlugins: ['fetchalo/federation'],
});
```

The remote server must answer the CORS preflight for the header: `Access-Control-Allow-Origin` and `Access-Control-Allow-Headers: Authorization`.

## API

```ts
fetchalo({
  origins: string[]; // origins whose files get the headers
  headers: string; // module: export default (url) => HeadersInit | Promise<HeadersInit>
});
```

## What goes through your fetch

For files on the configured `origins`:

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
- Not covered: SVG `<image>`, `<iframe>`, `<object>`, workers, `adoptedStyleSheets`, elements created with `innerHTML`, and `fetch()` calls made by the loaded code itself.
- Media is downloaded whole into a `blob:` URL: no streaming or range requests. `blob:` URLs are kept for the page's lifetime.
- It patches DOM prototypes (`appendChild`, `setAttribute`, `insertRule`, media setters) for the configured origins only.
- The injected script is inline: with a strict CSP, set Vite's `html.cspNonce` and the scripts carry it.
- With Module Federation, only `module`/`esm` remotes from built output; `var` remotes load through `<script>` tags.

## How it works

1. Vite: the plugin injects a classic script and es-module-shims at the top of `<head>`, and builds your headers module as a separate chunk, so it never waits on the app. webpack/Rspack: the plugin prepends the client, your headers module and es-module-shims to every entry.
2. Every request to the `origins` goes through `fetch` with your headers, and the browser gets the files from `blob:` URLs.

## Examples

[`examples/`](./examples) has a complete setup, which the e2e suite (`pnpm e2e`) runs in Chromium, Firefox and WebKit:

- [`remote`](./examples/remote): a Vite + Module Federation remote that serves its files only with an `Authorization` header. Its exposes use images, `srcset`, video, inline styles, CSS-in-JS backgrounds and fonts, and a stylesheet with an `@import`.
- [`vite-host`](./examples/vite-host): a Vite host with `fetchalo` and `fetchalo/federation`.
- [`bundler-host`](./examples/bundler-host): the same host with webpack (`fetchalo/webpack`) and Rspack (`fetchalo/rspack`).

```sh
pnpm install
pnpm build
pnpm --filter fetchalo-example-remote run preview      # http://localhost:5176, 401 without the token
pnpm --filter fetchalo-example-vite-host run preview   # http://localhost:5175
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
