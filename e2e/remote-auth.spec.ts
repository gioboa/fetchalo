import { expect, test } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { REMOTE_REQUEST_LOG } from '../playwright.config';

// Lines written by the remote's requireAuth middleware: "METHOD url STATUS dest".
function remoteRequests() {
  return readFileSync(REMOTE_REQUEST_LOG, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [method, url, status, dest] = line.split(' ');
      return { method, url, status: Number(status), dest };
    })
    .filter((request) => request.method !== 'OPTIONS');
}

const hostTitles: Record<string, string> = {
  vite: 'Vite host',
  'vite-runtime-plugin': 'Vite runtime plugin host',
  runtime: 'Runtime host',
  webpack: 'webpack host',
  rspack: 'Rspack host',
};

test.beforeEach(() => writeFileSync(REMOTE_REQUEST_LOG, ''));

test('loads every remote file with the token, without a service worker', async ({
  page,
  baseURL,
  browserName,
}, testInfo) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => {
    // Chromium/WebKit report this benign layout notice as an error.
    if (!error.message.includes('ResizeObserver')) pageErrors.push(error.message);
  });
  await page.goto('/');

  if (!new URL(baseURL!).hostname.startsWith('127.')) {
    expect(await page.evaluate(() => isSecureContext)).toBe(false);
    expect(await page.evaluate(() => 'serviceWorker' in navigator)).toBe(false);
  }

  const hostTitle = hostTitles[testInfo.project.name.replace(/-(chromium|firefox|webkit)$/, '')];
  for (const name of [hostTitle, 'Remote App', 'Remote assets']) {
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  }

  // <img src> (an .svg and a .png) and srcset.
  const imageLoaded = (testId: string) =>
    page
      .getByTestId(testId)
      .evaluate(
        (img: HTMLImageElement) => img.currentSrc.startsWith('blob:') && img.naturalWidth > 0
      );
  await expect.poll(() => imageLoaded('remote-logo')).toBe(true);
  await expect.poll(() => imageLoaded('remote-img')).toBe(true);
  await expect.poll(() => imageLoaded('remote-srcset')).toBe(true);

  // <video src> and poster.
  const video = page.getByTestId('remote-video');
  await expect
    .poll(() =>
      video.evaluate(
        (el: HTMLVideoElement) => el.src.startsWith('blob:') && el.poster.startsWith('blob:')
      )
    )
    .toBe(true);
  if (browserName !== 'webkit') {
    // WebKit's Linux build may lack the VP8 decoder; the request is still checked below.
    await expect
      .poll(() => video.evaluate((el: HTMLVideoElement) => el.readyState))
      .toBeGreaterThan(0);
  }

  // url()s in inline styles, CSS-in-JS rules and the <link> stylesheet's @import.
  const backgroundImage = (testId: string) =>
    page.getByTestId(testId).evaluate((el) => getComputedStyle(el).backgroundImage);
  await expect.poll(() => backgroundImage('remote-inline-style')).toContain('blob:');
  await expect.poll(() => backgroundImage('remote-css-in-js')).toContain('blob:');
  await expect
    .poll(() => page.getByTestId('remote-import-root').evaluate((el) => getComputedStyle(el).color))
    .toBe('rgb(1, 2, 3)');
  await expect.poll(() => backgroundImage('remote-imported')).toContain('blob:');
  // @font-face from CSS-in-JS.
  await expect
    .poll(() =>
      page.evaluate(async () => {
        await document.fonts.load('16px FetchaloSans');
        return document.fonts.check('16px FetchaloSans');
      })
    )
    .toBe(true);

  const requests = remoteRequests();
  for (const type of ['.js', '.css', '.json', '.png', '.svg', '.webm', '.woff']) {
    expect(
      requests.some(
        (request) => request.status === 200 && request.url.split('?')[0].endsWith(type)
      ),
      `a ${type} file was served with the token`
    ).toBe(true);
  }
  expect(requests.filter((request) => request.status === 401)).toEqual([]);
  expect(pageErrors).toEqual([]);
});
