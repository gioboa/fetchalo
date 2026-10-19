// Shared by webpack.config.js and rspack.config.js.
module.exports = (name) => ({
  name,
  dts: false,
  remotes: {
    remote1: 'remote1@http://localhost:5176/mf-manifest.json',
  },
  shared: {
    react: { singleton: true, requiredVersion: '^19.2.4' },
    'react-dom': { singleton: true, requiredVersion: '^19.2.4' },
  },
  // Loads the manifest and the remote entry through fetchalo.
  runtimePlugins: [require.resolve('fetchalo/federation')],
});
