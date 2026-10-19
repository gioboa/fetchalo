import {
  findCssImports,
  findCssUrls,
  mapSrcset,
  normalizeOrigins,
  replaceCssImports,
  replaceCssUrls,
  requestHeaders,
  srcsetUrls,
} from './rewrite';

/**
 * fetchalo's configuration: the default export of the app's `fetchalo.config` file
 * (for the build plugins), and the argument of `fetchalo/federation`.
 *
 * ```ts
 * import type { FetchaloConfig } from 'fetchalo';
 *
 * export default {
 *   origins: ['https://remote.example'],
 *   headers: (url) => ({ Authorization: `Bearer ${getToken()}` }),
 * } satisfies FetchaloConfig;
 * ```
 */
export type FetchaloConfig = {
  /** Origins whose files are fetched with the headers, e.g. `https://remote.example`. */
  origins: string[];
  /**
   * Headers for a request to the `origins`. Called for every request, so it can
   * return a refreshed token.
   */
  headers: (url: string) => HeadersInit | undefined | Promise<HeadersInit | undefined>;
};

/**
 * The default export of a `fetchalo.config` file: the config, or a function returning it
 * or a promise of it, for values computed in the browser (e.g. a fetched whitelist).
 */
export type FetchaloConfigExport =
  | FetchaloConfig
  | (() => FetchaloConfig | Promise<FetchaloConfig>);

/** The config from a `fetchalo.config` file's default export. */
export function loadConfig(
  configExport: FetchaloConfigExport
): FetchaloConfig | Promise<FetchaloConfig> {
  return typeof configExport === 'function' ? configExport() : configExport;
}

export type FetchaloClientOptions = {
  /** The app's config, or a promise of it (its file may still be loading). */
  config: FetchaloConfig | Promise<FetchaloConfig>;
};

declare global {
  interface Window {
    fetchalo: {
      fetch: typeof fetch;
      isTarget(url: string): boolean;
      /** Resolves once the origins are added: `isTarget` is final from then on. */
      ready: Promise<void>;
    };
  }
}

// es-module-shims declares `Window.esmsInitOptions` itself; read it loosely.
type EsmsWindow = { esmsInitOptions?: { fetch?: unknown; [option: string]: unknown } };

/**
 * Installs fetchalo in the page: must run before es-module-shims and before any
 * request to the `origins`. Every request for a file on those origins then goes
 * through `window.fetchalo.fetch`, which carries the headers:
 *
 * - JS: es-module-shims (shim mode) loads module graphs through it.
 * - CSS: <link rel="stylesheet"> and their @imports, <style> text, CSSOM rules and
 *   inline styles.
 * - Media: <img>, <source>, <video>, <audio> (`src`, `srcset`, `poster`).
 *
 * Files are served to the browser from blob: URLs. With a config given as a promise,
 * its origins are targets once it resolves (`window.fetchalo.ready`).
 */
export function installFetchalo(options: FetchaloClientOptions): void {
  const origins = new Set<string>();
  // An invalid origin is reported and skipped.
  const addOrigins = (list: string[] | undefined): void => {
    for (const origin of list ?? []) {
      try {
        normalizeOrigins([origin]).forEach((normalized) => origins.add(normalized));
      } catch (error) {
        console.error(error);
      }
    }
  };
  // A config's origins are in effect at once, a promised config's once it resolves.
  const isAsync = options.config instanceof Promise;
  if (!(options.config instanceof Promise)) addOrigins(options.config.origins);
  const config = Promise.resolve(options.config).catch((error) => {
    console.error('[fetchalo] could not load the config', error);
    return undefined;
  });
  const ready = config.then((resolved) => {
    if (isAsync) addOrigins(resolved?.origins);
    if (origins.size === 0)
      console.warn('[fetchalo] no origins: nothing is fetched with the headers');
  });

  const isTarget = (url: string): boolean => {
    try {
      return origins.has(new URL(url, location.href).origin);
    } catch {
      return false;
    }
  };

  // An es-module-shims fetch hook the app configured before this script still runs.
  const esmsWindow = window as unknown as EsmsWindow;
  const baseFetch = (esmsWindow.esmsInitOptions?.fetch as typeof fetch | undefined) ?? fetch;

  const fetchalo = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = input instanceof Request ? input.url : String(input);
    await ready;
    if (!isTarget(url)) return baseFetch(input, init);
    // A target exists only when the config resolved.
    const { headers: getHeaders } = (await config)!;
    const headers = requestHeaders(input, init);
    new Headers((await getHeaders(url)) ?? {}).forEach((value, name) => headers.set(name, value));
    return baseFetch(input, { ...init, headers });
  }) as typeof fetch;

  window.fetchalo = { fetch: fetchalo, isTarget, ready };
  esmsWindow.esmsInitOptions = { ...esmsWindow.esmsInitOptions, shimMode: true, fetch: fetchalo };

  // Files fetched with the headers, served from blob: URLs. One per URL.
  const blobUrls = new Map<string, Promise<string>>();
  const resolvedBlobUrls = new Map<string, string>();
  const toBlobUrl = (url: string): Promise<string> => {
    let promise = blobUrls.get(url);
    if (!promise) {
      promise = fetchalo(url)
        .then((res) => (res.ok ? res.blob() : Promise.reject(new Error(`${res.status} ${url}`))))
        .then((blob) => {
          const blobUrl = URL.createObjectURL(blob);
          resolvedBlobUrls.set(url, blobUrl);
          return blobUrl;
        });
      promise.catch(() => blobUrls.delete(url));
      blobUrls.set(url, promise);
    }
    return promise;
  };

  // --- CSS: url()s in stylesheets, <style> tags, CSSOM rules and inline styles ---

  const targetCssUrls = (css: string, base: string) => findCssUrls(css, base, isTarget);
  const replaceTargetUrls = (css: string, urls: { url: string }[], replacements: string[]) =>
    replaceCssUrls(css, new Map(urls.map(({ url }, i) => [url, replacements[i]])));

  // Rewrites the target url()s in `css` to blob: URLs.
  const rewriteCss = async (css: string, base = location.href): Promise<string> => {
    const urls = targetCssUrls(css, base);
    if (urls.length === 0) return css;
    const blobs = await Promise.all(urls.map(({ absolute }) => toBlobUrl(absolute)));
    return replaceTargetUrls(css, urls, blobs);
  };

  // Synchronous version: url()s not fetched yet become an empty data: URL, which
  // needs no network request, so nothing goes out without the headers.
  const PLACEHOLDER = 'data:,';
  const placeholderCss = (css: string): string => {
    const urls = targetCssUrls(css, location.href);
    return replaceTargetUrls(
      css,
      urls,
      urls.map(({ absolute }) => resolvedBlobUrls.get(absolute) ?? PLACEHOLDER)
    );
  };

  // Stylesheets added with <link> or @import, as blob: URLs, once per href. A blob:
  // stylesheet has no base URL, so @imports and url()s are resolved against the
  // stylesheet first. `chain` breaks @import cycles.
  const stylesheetBlobs = new Map<string, Promise<string>>();
  const loadStylesheet = (href: string, chain: string[] = []): Promise<string> => {
    let promise = stylesheetBlobs.get(href);
    if (!promise) {
      promise = (async () => {
        const res = await fetchalo(href);
        if (!res.ok) throw new Error(`${res.status} ${href}`);
        let css = await res.text();
        const imports = findCssImports(css, href, isTarget).filter(
          ({ absolute }) => !chain.includes(absolute)
        );
        const importBlobs = await Promise.all(
          imports.map(({ absolute }) => loadStylesheet(absolute, [...chain, href]))
        );
        css = replaceCssImports(css, new Map(imports.map(({ url }, i) => [url, importBlobs[i]])));
        css = await rewriteCss(css, href);
        return URL.createObjectURL(new Blob([css], { type: 'text/css' }));
      })();
      promise.catch(() => stylesheetBlobs.delete(href));
      stylesheetBlobs.set(href, promise);
    }
    return promise;
  };

  // CSS-in-JS libraries insert rules through the CSSOM in production. A rule whose
  // url()s are not fetched yet is inserted with placeholders and replaced once they are.
  const insertRule = CSSStyleSheet.prototype.insertRule;
  const deleteRule = CSSStyleSheet.prototype.deleteRule;
  CSSStyleSheet.prototype.insertRule = function (rule: string, index?: number) {
    if (targetCssUrls(rule, location.href).length === 0) return insertRule.call(this, rule, index);
    const placeholder = placeholderCss(rule);
    const inserted = insertRule.call(this, placeholder, index);
    if (!placeholder.includes(PLACEHOLDER)) return inserted;
    const cssRule = this.cssRules[inserted];
    rewriteCss(rule).then((css) => {
      const current = Array.prototype.indexOf.call(this.cssRules, cssRule);
      if (current === -1) return;
      deleteRule.call(this, current);
      insertRule.call(this, css, current);
    });
    return inserted;
  };

  // <style> text (CSS-in-JS in development) and inline style attributes. Mutation
  // observers run before the next render, so the placeholders go in before any request.
  const rewriteStyleElement = (style: HTMLStyleElement): void => {
    const css = style.textContent ?? '';
    if (targetCssUrls(css, location.href).length === 0) return;
    style.textContent = placeholderCss(css);
    const placeholder = style.textContent;
    rewriteCss(css).then((rewritten) => {
      if (style.textContent === placeholder) style.textContent = rewritten;
    });
  };
  const rewriteInlineStyle = (element: Element): void => {
    const css = element.getAttribute('style');
    if (!css || targetCssUrls(css, location.href).length === 0) return;
    const { style } = element as HTMLElement;
    style.cssText = placeholderCss(css);
    const placeholder = element.getAttribute('style');
    rewriteCss(css).then((rewritten) => {
      if (element.getAttribute('style') === placeholder) style.cssText = rewritten;
    });
  };
  const rewriteSubtree = (node: Node): void => {
    if (!(node instanceof Element)) return;
    if (node instanceof HTMLStyleElement) rewriteStyleElement(node);
    if (node.hasAttribute('style')) rewriteInlineStyle(node);
    node.querySelectorAll('style').forEach(rewriteStyleElement);
    node.querySelectorAll('[style]').forEach(rewriteInlineStyle);
  };
  new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'attributes') {
        rewriteInlineStyle(record.target as Element);
      } else if (record.type === 'characterData') {
        const parent = record.target.parentNode;
        if (parent instanceof HTMLStyleElement) rewriteStyleElement(parent);
      } else {
        if (record.target instanceof HTMLStyleElement) rewriteStyleElement(record.target);
        record.addedNodes.forEach(rewriteSubtree);
      }
    }
  }).observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['style'],
  });

  // --- <link>: e.g. Vite's preload helper ---

  // <link> tags cannot carry headers. Preload hints to the origins are dropped
  // (es-module-shims fetches the modules; other files are fetched when used) and
  // stylesheets load through fetchalo, then get inserted with a blob: href. A
  // stylesheet is inserted once: loaders looking for the original href (e.g. Vite's
  // preload helper) never find it, so they would add it again for every chunk.
  const PRELOAD_RELS = new Set(['modulepreload', 'preload', 'prefetch']);
  const insertedStylesheets = new Map<string, Promise<unknown>>();
  // Returns true when `node` is a <link> to the origins that this script handles.
  const interceptLink = (node: Node, insert: () => void): boolean => {
    if (!(node instanceof HTMLLinkElement) || !node.href || !isTarget(node.href)) return false;
    if (PRELOAD_RELS.has(node.rel)) return true;
    if (node.rel !== 'stylesheet') return false;
    const href = node.href;
    const inserted = insertedStylesheets.get(href);
    if (inserted) {
      inserted.then(
        () => node.dispatchEvent(new Event('load')),
        () => node.dispatchEvent(new Event('error'))
      );
      return true;
    }
    const promise = loadStylesheet(href).then((blobHref) => {
      node.href = blobHref;
      insert();
      // The `load` event fires on the inserted node itself.
    });
    insertedStylesheets.set(href, promise);
    promise.catch(() => {
      insertedStylesheets.delete(href);
      node.dispatchEvent(new Event('error'));
    });
    return true;
  };
  const appendChild = Node.prototype.appendChild;
  Node.prototype.appendChild = function <T extends Node>(this: Node, node: T): T {
    if (interceptLink(node, () => appendChild.call(this, node))) return node;
    return appendChild.call(this, node) as T;
  };
  const insertBefore = Node.prototype.insertBefore;
  Node.prototype.insertBefore = function <T extends Node>(
    this: Node,
    node: T,
    child: Node | null
  ): T {
    const anchor = child?.isConnected ? child : null;
    if (interceptLink(node, () => insertBefore.call(this, node, anchor))) return node;
    return insertBefore.call(this, node, child) as T;
  };
  for (const method of ['append', 'prepend'] as const) {
    const original = Element.prototype[method];
    Element.prototype[method] = function (this: Element, ...nodes: (Node | string)[]) {
      const rest = nodes.filter(
        (node) => typeof node === 'string' || !interceptLink(node, () => original.call(this, node))
      );
      if (rest.length) original.apply(this, rest);
    };
  }

  // --- Media: <img>, <source>, <video>, <audio> ---

  const rewriteSrcset = (srcset: string): Promise<string> =>
    mapSrcset(srcset, isTarget, (url) => toBlobUrl(new URL(url, location.href).href));

  type Setter = (this: Element, value: string) => void;
  const mediaAttributes: [typeof HTMLElement, string[]][] = [
    [HTMLImageElement, ['src', 'srcset']],
    [HTMLSourceElement, ['src', 'srcset']],
    [HTMLMediaElement, ['src']],
    [HTMLVideoElement, ['poster']],
  ];
  const nativeSetters = new Map<typeof HTMLElement, Map<string, Setter>>();
  const nativeSetter = (element: Element, name: string): Setter | undefined => {
    for (const [type, names] of mediaAttributes) {
      if (element instanceof type && names.includes(name))
        return nativeSetters.get(type)!.get(name);
    }
    return undefined;
  };
  const needsFetch = (name: string, value: unknown): value is string =>
    typeof value === 'string' &&
    (name === 'srcset' ? srcsetUrls(value, isTarget).length > 0 : isTarget(value));

  // Latest value per element and attribute: a newer value wins over a pending fetch.
  const pendingMedia = new WeakMap<Element, Record<string, string | undefined>>();

  // Sets the attribute to the blob: URL(s) once fetched.
  const setTargetMedia = (element: Element, name: string, value: string, set: Setter): void => {
    let pending = pendingMedia.get(element);
    if (!pending) pendingMedia.set(element, (pending = {}));
    pending[name] = value;
    const rewritten =
      name === 'srcset' ? rewriteSrcset(value) : toBlobUrl(new URL(value, location.href).href);
    rewritten.then(
      (blobValue) => {
        if (pending[name] !== value) return;
        set.call(element, blobValue);
        // A <source> is only picked when its media element (re)loads.
        if (
          element instanceof HTMLSourceElement &&
          element.parentNode instanceof HTMLMediaElement
        ) {
          element.parentNode.load();
        }
      },
      () => pending[name] === value && set.call(element, value)
    );
  };

  for (const [type, names] of mediaAttributes) {
    const setters = new Map<string, Setter>();
    nativeSetters.set(type, setters);
    for (const name of names) {
      const descriptor = Object.getOwnPropertyDescriptor(type.prototype, name)!;
      const set = descriptor.set as Setter;
      setters.set(name, set);
      Object.defineProperty(type.prototype, name, {
        ...descriptor,
        set(this: Element, value: string) {
          if (needsFetch(name, value)) return setTargetMedia(this, name, value, set);
          const pending = pendingMedia.get(this);
          if (pending) pending[name] = undefined;
          set.call(this, value);
        },
      });
    }
  }

  const setAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name: string, value: string) {
    // HTML attribute names are case-insensitive: React sets `srcSet`.
    const attribute = String(name).toLowerCase();
    const set = nativeSetter(this, attribute);
    if (set && needsFetch(attribute, value)) return setTargetMedia(this, attribute, value, set);
    return setAttribute.call(this, name, value);
  };
}
