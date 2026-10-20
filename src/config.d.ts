// Resolved by the webpack/Rspack plugin's alias to the app's config file.
declare module 'fetchalo/config' {
  import type { FetchaloConfigExport } from './client-core';
  const configExport: FetchaloConfigExport;
  export default configExport;
}
