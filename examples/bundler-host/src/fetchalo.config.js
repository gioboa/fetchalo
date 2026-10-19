// fetchalo's config: loaded in the browser before the app. It must not import anything
// from the remote.

/** @type {import('fetchalo').FetchaloConfig} */
export default {
  origins: ['http://localhost:5176'],
  // Called per request, so a real app can return a refreshed token from its auth state.
  headers: () => ({ Authorization: 'Bearer fetchalo-demo-token' }),
};
