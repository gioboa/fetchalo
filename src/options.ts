/** Throws unless the plugins' argument is the path of the config file. */
export function checkConfigPath(configPath: unknown): asserts configPath is string {
  if (typeof configPath !== 'string') {
    throw new Error('[fetchalo] pass the path of the config file, e.g. `./src/fetchalo.config.ts`');
  }
}
