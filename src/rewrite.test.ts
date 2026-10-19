import { describe, expect, it } from 'vitest';
import { findCssUrls, mapSrcset, replaceCssUrls, requestHeaders, srcsetUrls } from './rewrite';

const isTarget = (url: string) => url.startsWith('https://remote.example/');
const base = 'https://remote.example/assets/style.css';

describe('findCssUrls', () => {
  it('resolves relative url()s against the stylesheet and keeps only target origins', () => {
    const css = `
      a { background: url(./a.png) }
      b { background: url('../b.png'), url( "c.png" ) }
      c { background: url(https://other.example/d.png), url(data:image/png;base64,xx), url(#id) }
      d { background: url(/root.png) }
    `;
    expect(findCssUrls(css, base, isTarget)).toEqual([
      { url: './a.png', absolute: 'https://remote.example/assets/a.png' },
      { url: '../b.png', absolute: 'https://remote.example/b.png' },
      { url: 'c.png', absolute: 'https://remote.example/assets/c.png' },
      { url: '/root.png', absolute: 'https://remote.example/root.png' },
    ]);
  });

  it('skips urls that do not parse', () => {
    expect(findCssUrls('a { background: url(a.png) }', 'not a url', isTarget)).toEqual([]);
  });
});

describe('replaceCssUrls', () => {
  it('replaces whole url() tokens only, so a url never matches inside another', () => {
    const css = 'a { background: url(a.png) } b { background: url("data.png"), url( a.png ) }';
    const out = replaceCssUrls(css, new Map([['a.png', 'blob:1']]));
    expect(out).toBe(
      'a { background: url(blob:1) } b { background: url("data.png"), url(blob:1) }'
    );
  });
});

describe('srcset', () => {
  it('lists the target candidates', () => {
    const srcset =
      'https://remote.example/a.png 1x, https://other.example/b.png 2x,https://remote.example/a.png 3x';
    expect(srcsetUrls(srcset, isTarget)).toEqual([
      'https://remote.example/a.png',
      'https://remote.example/a.png',
    ]);
  });

  it('maps each candidate on its own, keeping descriptors and other origins', async () => {
    const srcset =
      'https://remote.example/a.png 1x, https://remote.example/a.png.webp 2x, https://other.example/b.png 3x';
    const out = await mapSrcset(srcset, isTarget, async (url) => `blob:${url.split('/').pop()}`);
    expect(out).toBe('blob:a.png 1x, blob:a.png.webp 2x, https://other.example/b.png 3x');
  });
});

describe('requestHeaders', () => {
  it('starts from the Request headers when init has none', () => {
    const request = new Request('https://remote.example/x', { headers: { 'X-A': '1' } });
    expect(requestHeaders(request, {}).get('X-A')).toBe('1');
  });

  it('lets init.headers replace them, as fetch does', () => {
    const request = new Request('https://remote.example/x', { headers: { 'X-A': '1' } });
    const headers = requestHeaders(request, { headers: { 'X-B': '2' } });
    expect(headers.get('X-A')).toBe(null);
    expect(headers.get('X-B')).toBe('2');
  });
});

describe('@import', () => {
  it('finds target imports in both forms and keeps the rest of the at-rule', async () => {
    const { findCssImports, replaceCssImports } = await import('./rewrite');
    const css = `@import "./a.css";\n@import url( 'b.css' ) layer(x) screen;\n@import url(https://other.example/c.css);`;
    const imports = findCssImports(css, base, isTarget);
    expect(imports).toEqual([
      { url: './a.css', absolute: 'https://remote.example/assets/a.css' },
      { url: 'b.css', absolute: 'https://remote.example/assets/b.css' },
    ]);
    const out = replaceCssImports(
      css,
      new Map([
        ['./a.css', 'blob:a'],
        ['b.css', 'blob:b'],
      ])
    );
    expect(out).toBe(
      `@import "blob:a";\n@import "blob:b" layer(x) screen;\n@import url(https://other.example/c.css);`
    );
  });
});

describe('publicPath', () => {
  it('prefixes an absolute base and walks up from the page for a relative one', async () => {
    const { publicPath } = await import('./rewrite');
    expect(publicPath('/', '/index.html', 'assets/x.js')).toBe('/assets/x.js');
    expect(publicPath('/app/', '/nested/index.html', 'assets/x.js')).toBe('/app/assets/x.js');
    expect(publicPath('./', '/index.html', 'assets/x.js')).toBe('./assets/x.js');
    expect(publicPath('./', '/nested/deep/index.html', 'assets/x.js')).toBe('../../assets/x.js');
  });
});
