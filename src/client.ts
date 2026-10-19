/**
 * Classic script that the Vite plugin injects at the top of <head>, before
 * es-module-shims. The plugin fills in the placeholder.
 */
import { installFetchalo, loadConfig } from './client-core';

declare const __FETCHALO_CONFIG__: string;

installFetchalo({
  // The app's config file, loaded on its own so it never waits on the app.
  config: import(__FETCHALO_CONFIG__).then((module) => loadConfig(module.default)),
});
