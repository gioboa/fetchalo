// Headers for every request to the remote. Called per request, so a real app can
// return a refreshed token from its auth state. Loaded before the app: it must
// not import anything from the remote.
export default async function remoteHeaders(url) {
  return { Authorization: 'Bearer fetchalo-demo-token' };
}
