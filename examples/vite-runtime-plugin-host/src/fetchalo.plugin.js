// Module Federation runtime plugin (see runtimePlugins in vite.config.js): installs
// fetchalo, so the remote's files load with the headers. It must not import anything
// from the remote.
import fetchaloFederation from 'fetchalo/federation';

export default () =>
  fetchaloFederation({
    origins: ['http://localhost:5176'],
    // Called per request, so a real app can return a refreshed token from its auth state.
    headers: () => ({ Authorization: 'Bearer fetchalo-demo-token' }),
  });
