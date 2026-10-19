import { createInstance } from '@module-federation/runtime';
import fetchaloFederation from 'fetchalo/federation';
import React from 'react';
import ReactDOM from 'react-dom';
import { createRoot } from 'react-dom/client';

// No build plugins: the remote and fetchalo are registered with the runtime API.
const mf = createInstance({ name: 'runtimeHost', remotes: [] });

// The remote's origin, resolved at runtime: a real app could fetch a whitelist here, or
// use location.origin when the remotes are on the host's domain.
const fetchWhitelist = () =>
  new Promise((resolve) => setTimeout(() => resolve(['http://localhost:5176']), 100));

mf.registerPlugins([
  fetchaloFederation(
    fetchWhitelist().then((origins) => ({
      origins,
      // Called per request, so a real app can return a refreshed token from its auth state.
      headers: () => ({ Authorization: 'Bearer fetchalo-demo-token' }),
    }))
  ),
]);

mf.registerShared({
  react: {
    version: React.version,
    scope: 'default',
    get: async () => () => React,
    shareConfig: { singleton: true, requiredVersion: `^${React.version}` },
  },
  'react-dom': {
    version: ReactDOM.version,
    scope: 'default',
    get: async () => () => ReactDOM,
    shareConfig: { singleton: true, requiredVersion: `^${ReactDOM.version}` },
  },
});

mf.registerRemotes([
  { name: 'remote1', entry: 'http://localhost:5176/mf-manifest.json', type: 'module' },
]);

const [{ default: RemoteApp }, { default: RemoteAssets }] = await Promise.all([
  mf.loadRemote('remote1/App'),
  mf.loadRemote('remote1/Assets'),
]);

createRoot(document.getElementById('app')).render(
  <>
    <h1>Runtime host</h1>
    <RemoteApp />
    <RemoteAssets />
  </>
);
