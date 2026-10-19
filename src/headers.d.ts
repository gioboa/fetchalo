// Resolved by the webpack/Rspack plugin's alias to the app's headers module.
declare module 'fetchalo/headers' {
  import type { HeadersFn } from './client-core';
  const headers: HeadersFn;
  export default headers;
}
