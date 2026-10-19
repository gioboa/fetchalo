/**
 * Classic script that the Vite plugin injects at the top of <head>, before
 * es-module-shims. The plugin fills in the two placeholders.
 */
import { installFetchalo } from './client-core';

declare const __FETCHALO_ORIGINS__: string[];
declare const __FETCHALO_HEADERS__: string;

installFetchalo({
  origins: __FETCHALO_ORIGINS__,
  // The app's headers module, loaded on its own so it never waits on the app.
  headers: import(__FETCHALO_HEADERS__).then((module) => module.default),
});
