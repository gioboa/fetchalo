/**
 * Module Federation runtime plugin: loads remote manifests and `module`/`esm` remote
 * entries on the fetchalo origins through fetchalo, so they carry the headers.
 *
 * Given a config (`{ origins, headers }`), it installs fetchalo in the page itself, so
 * no build plugin is needed. With the runtime API:
 *
 * ```js
 * mf.registerPlugins([
 *   fetchaloFederation({
 *     origins: ['https://remote.example'],
 *     headers: (url) => ({ Authorization: `Bearer ${getToken()}` }),
 *   }),
 * ]);
 * ```
 *
 * Without one, it uses the fetchalo that the Vite or webpack/Rspack plugin installed:
 *
 * ```js
 * federation({ runtimePlugins: ['fetchalo/federation'] })
 * ```
 */
import { installFetchalo, type FetchaloConfig } from './client-core';

type RemoteInfo = { name: string; entry: string; type?: string };

type LoadEntryArgs = { remoteInfo: RemoteInfo; remoteEntryExports?: unknown };

declare function importShim(specifier: string): Promise<unknown>;

// The fetchalo installed in the page (by a build plugin or by this plugin), if any.
const installedFetchalo = (): Window['fetchalo'] | undefined =>
  (globalThis as { fetchalo?: Window['fetchalo'] }).fetchalo;

// Once the origins are added, so `isTarget` covers them.
const getFetchalo = async (): Promise<Window['fetchalo'] | undefined> => {
  const fetchalo = installedFetchalo();
  await fetchalo?.ready;
  return fetchalo;
};

// This module's installation, shared by every plugin it creates (e.g. one per federation
// instance): the first config installs fetchalo, later ones are not used.
let installed: Promise<unknown> | undefined;

// Installs fetchalo and es-module-shims once, unless a build plugin already did (or there
// is no page: SSR). Resolves once `importShim` is defined.
function install(config: FetchaloConfig | Promise<FetchaloConfig>): Promise<unknown> {
  if (installed) return installed;
  if (typeof window === 'undefined') return Promise.resolve();
  if (installedFetchalo()) {
    console.warn(
      '[fetchalo] already installed by a build plugin: the config passed to fetchalo/federation is ignored'
    );
    return Promise.resolve();
  }
  installFetchalo({ config });
  installed = import('./federation-shims');
  return installed;
}

export default function fetchaloFederation(config?: FetchaloConfig | Promise<FetchaloConfig>) {
  const shimsReady = config ? install(config) : Promise.resolve();
  return {
    name: 'fetchalo',
    async fetch(url: string, init?: RequestInit) {
      const fetchalo = await getFetchalo();
      return fetchalo?.isTarget(url) ? fetchalo.fetch(url, init) : undefined;
    },
    async loadEntry({ remoteInfo, remoteEntryExports }: LoadEntryArgs) {
      if (remoteEntryExports) return remoteEntryExports;
      if (remoteInfo.type !== 'module' && remoteInfo.type !== 'esm') return undefined;
      if (!(await getFetchalo())?.isTarget(remoteInfo.entry)) return undefined;
      try {
        await shimsReady;
        return await importShim(remoteInfo.entry);
      } catch (error) {
        // The runtime only retries entries (loadEntryError hook) on RUNTIME-008 errors.
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          `[ Federation Runtime ]: Failed to load script resources. #RUNTIME-008\n` +
            `args: ${JSON.stringify({ remoteName: remoteInfo.name, resourceUrl: remoteInfo.entry })}\n` +
            `Original Error Message:\n ${message}`
        );
      }
    },
  };
}
