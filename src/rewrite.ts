/**
 * Pure helpers shared by the client, kept DOM-free so they can be unit tested.
 */

export type IsTarget = (url: string) => boolean;
export type CssUrl = { url: string; absolute: string };

// `url(x)`, `url('x')`, `url( "x" )`. Lazy, so the spaces before `)` stay out of the url.
export const CSS_URL = /url\(\s*(['"]?)([^'")]+?)\1\s*\)/g;

/** The url()s in `css` that point at a target origin, resolved against `base`. */
export function findCssUrls(css: string, base: string, isTarget: IsTarget): CssUrl[] {
  const urls = new Map<string, CssUrl>();
  for (const match of css.matchAll(CSS_URL)) {
    const url = match[2];
    if (/^(data|blob):|^#/.test(url)) continue;
    let absolute: string;
    try {
      absolute = new URL(url, base).href;
    } catch {
      continue;
    }
    if (isTarget(absolute)) urls.set(url, { url, absolute });
  }
  return [...urls.values()];
}

/** Replaces whole `url(...)` tokens only, so `a.png` never matches inside `data.png`. */
export function replaceCssUrls(css: string, replacements: Map<string, string>): string {
  return css.replace(CSS_URL, (token, quote, url) =>
    replacements.has(url) ? `url(${quote}${replacements.get(url)}${quote})` : token
  );
}

/** The candidate URLs of a `srcset` ("url descriptor, url descriptor") on a target origin. */
export function srcsetUrls(srcset: string, isTarget: IsTarget): string[] {
  return srcset
    .split(',')
    .map((candidate) => candidate.trim().split(/\s+/)[0])
    .filter((url) => url && isTarget(url));
}

/** Rewrites each target candidate's URL on its own, so one URL never matches inside another. */
export async function mapSrcset(
  srcset: string,
  isTarget: IsTarget,
  map: (url: string) => Promise<string>
): Promise<string> {
  const candidates = await Promise.all(
    srcset.split(',').map(async (candidate) => {
      const [url, ...descriptors] = candidate.trim().split(/\s+/);
      if (!url || !isTarget(url)) return candidate.trim();
      return [await map(url), ...descriptors].join(' ');
    })
  );
  return candidates.join(', ');
}

/** The headers of a fetch call: `init.headers` replaces a Request's own, so start from those. */
export function requestHeaders(input: RequestInfo | URL, init: RequestInit): Headers {
  if (init.headers) return new Headers(init.headers);
  return new Headers(input instanceof Request ? input.headers : undefined);
}

// `@import "x.css"`, `@import url(x.css) layer(a) screen;`.
export const CSS_IMPORT = /@import\s+(?:url\(\s*(['"]?)([^'")]+?)\1\s*\)|(['"])([^'"]+)\3)/g;

/** The `@import`ed stylesheets of `css` that live on a target origin. */
export function findCssImports(css: string, base: string, isTarget: IsTarget): CssUrl[] {
  const urls = new Map<string, CssUrl>();
  for (const match of css.matchAll(CSS_IMPORT)) {
    const url = match[2] ?? match[4];
    let absolute: string;
    try {
      absolute = new URL(url, base).href;
    } catch {
      continue;
    }
    if (isTarget(absolute)) urls.set(url, { url, absolute });
  }
  return [...urls.values()];
}

/** Replaces the `@import` targets, keeping the rest of the at-rule. */
export function replaceCssImports(css: string, replacements: Map<string, string>): string {
  return css.replace(CSS_IMPORT, (token, q1, url1, q2, url2) => {
    const url = url1 ?? url2;
    if (!replacements.has(url)) return token;
    const quote = q2 ?? '"';
    return `@import ${quote}${replacements.get(url)}${quote}`;
  });
}

/** Where `file` is served from, for an HTML page at `htmlPath`, given Vite's `base`. */
export function publicPath(base: string, htmlPath: string, file: string): string {
  if (!base.startsWith('.')) return `${base}${file}`;
  // Relative base: like Vite, paths are relative to the page's directory.
  const depth = htmlPath.split('/').filter(Boolean).length - 1;
  return `${depth > 0 ? '../'.repeat(depth) : './'}${file}`;
}

/** `URL.origin` has no trailing slash or path: `https://remote.example/` would never match. */
export function normalizeOrigin(origin: string): string {
  let url: URL | undefined;
  try {
    url = new URL(origin);
  } catch {
    url = undefined;
  }
  if (!url || url.origin === 'null') {
    throw new Error(`[fetchalo] invalid origin "${origin}": use e.g. "https://remote.example"`);
  }
  return url.origin;
}
