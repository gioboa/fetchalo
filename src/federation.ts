/**
 * Module Federation runtime plugin: loads remote manifests and `module`/`esm` remote
 * entries on the fetchalo origins through fetchalo, so they carry the headers.
 *
 * ```js
 * federation({ runtimePlugins: ['fetchalo/federation'] })
 * ```
 */

type RemoteInfo = { name: string; entry: string; type?: string };

type LoadEntryArgs = { remoteInfo: RemoteInfo; remoteEntryExports?: unknown };

declare function importShim(specifier: string): Promise<unknown>;

const getFetchalo = () =>
  (globalThis as { fetchalo?: { fetch: typeof fetch; isTarget(url: string): boolean } }).fetchalo;

export default function fetchaloFederation() {
  return {
    name: 'fetchalo',
    fetch(url: string, init?: RequestInit) {
      const fetchalo = getFetchalo();
      return fetchalo?.isTarget(url) ? fetchalo.fetch(url, init) : undefined;
    },
    async loadEntry({ remoteInfo, remoteEntryExports }: LoadEntryArgs) {
      if (remoteEntryExports) return remoteEntryExports;
      if (remoteInfo.type !== 'module' && remoteInfo.type !== 'esm') return undefined;
      if (!getFetchalo()?.isTarget(remoteInfo.entry)) return undefined;
      try {
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
