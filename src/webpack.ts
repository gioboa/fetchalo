import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkConfigPath } from './options';

export type { FetchaloConfig, FetchaloConfigExport } from './client-core';

type EntryDescription = { import: string[]; [option: string]: unknown };
type EntryObject = Record<string, string | string[] | EntryDescription>;
type Entry = string | string[] | EntryObject | (() => Entry | Promise<Entry>);

const ENTRY_FILE = fileURLToPath(new URL('./webpack-entry.js', import.meta.url));
const CONFIG_ALIAS = 'fetchalo/config';
const SHIMS_FILE_RE = /[\\/]es-module-shims[\\/]dist[\\/]es-module-shims(\.debug|\.wasm)?\.js$/;

/**
 * webpack and Rspack plugin: prepends the fetchalo client and es-module-shims to
 * every entry, so they run before the app and before any request to the `origins`.
 * With Module Federation, also add `fetchalo/federation` to the federation
 * `runtimePlugins`.
 *
 * ```js
 * const { FetchaloPlugin } = require('fetchalo/webpack'); // or 'fetchalo/rspack'
 * plugins: [new FetchaloPlugin('./src/fetchalo.config.js')]
 * ```
 */
export class FetchaloPlugin {
  private readonly configPath: string;

  /** @param configPath The app's `fetchalo.config` file, e.g. `./src/fetchalo.config.js`. */
  constructor(configPath: string) {
    checkConfigPath(configPath);
    this.configPath = configPath;
  }

  apply(compiler: any): void {
    const { options } = compiler;

    // `fetchalo/config` -> the app's config file.
    const context: string = options.context ?? compiler.context ?? process.cwd();
    const configFilePath = path.resolve(context, this.configPath);
    const alias = options.resolve.alias ?? {};
    if (Array.isArray(alias)) {
      alias.push({ name: CONFIG_ALIAS, alias: configFilePath, onlyModule: true });
    } else {
      alias[`${CONFIG_ALIAS}$`] = configFilePath;
    }
    options.resolve.alias = alias;

    // es-module-shims is self-contained and loads modules with native `import(url)`:
    // left unparsed, so the bundler does not turn those into its own chunk requests.
    options.module ??= {};
    options.module.noParse = addNoParse(options.module.noParse, SHIMS_FILE_RE);

    options.entry = prependEntry(options.entry, ENTRY_FILE);
  }
}

type NoParse = RegExp | string | ((request: string) => boolean) | (RegExp | string)[] | undefined;

function addNoParse(current: NoParse, pattern: RegExp): NoParse {
  if (!current) return pattern;
  if (typeof current === 'function') {
    return (request: string) => pattern.test(request) || current(request);
  }
  return [...(Array.isArray(current) ? current : [current]), pattern];
}

export { FetchaloPlugin as default };

function prependEntry(entry: Entry, file: string): Entry {
  if (typeof entry === 'function') {
    return async () => prependEntry(await entry(), file);
  }
  if (typeof entry === 'string') return [file, entry];
  if (Array.isArray(entry)) return [file, ...entry];
  const prepended: EntryObject = {};
  for (const [name, description] of Object.entries(entry)) {
    if (typeof description === 'string') prepended[name] = [file, description];
    else if (Array.isArray(description)) prepended[name] = [file, ...description];
    else prepended[name] = { ...description, import: [file, ...description.import] };
  }
  return prepended;
}
