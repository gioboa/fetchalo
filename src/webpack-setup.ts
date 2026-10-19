/**
 * First module of every webpack/Rspack entry (see webpack.ts). `fetchalo/headers`
 * is an alias the plugin points at the app's headers module, and the origins come
 * from DefinePlugin.
 */
import headers from 'fetchalo/headers';
import { installFetchalo } from './client-core';

declare const __FETCHALO_ORIGINS__: string[];

installFetchalo({ origins: __FETCHALO_ORIGINS__, headers });
