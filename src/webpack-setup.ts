/**
 * First module of every webpack/Rspack entry (see webpack.ts). `fetchalo/config` is an
 * alias the plugin points at the app's config file.
 */
import configExport from 'fetchalo/config';
import { installFetchalo, loadConfig } from './client-core';

installFetchalo({ config: loadConfig(configExport) });
