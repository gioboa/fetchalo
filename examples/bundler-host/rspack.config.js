const rspack = require('@rspack/core');
const { ModuleFederationPlugin } = require('@module-federation/enhanced/rspack');
const { FetchaloPlugin } = require('fetchalo/rspack');
const federationConfig = require('./federation.config.js');

/** @type {import('@rspack/cli').Configuration} */
module.exports = {
  context: __dirname,
  entry: { main: './src/index.js' },
  output: { publicPath: 'auto', uniqueName: 'rspackHost' },
  resolve: { extensions: ['.jsx', '.js'] },
  devServer: {
    port: 8085,
    host: '0.0.0.0',
    allowedHosts: 'all',
    hot: false,
    liveReload: false,
    client: { overlay: false },
  },
  lazyCompilation: false,
  module: {
    rules: [
      {
        test: /\.jsx?$/,
        exclude: /node_modules/,
        use: {
          loader: 'builtin:swc-loader',
          options: {
            jsc: {
              parser: { syntax: 'ecmascript', jsx: true },
              transform: { react: { runtime: 'automatic' } },
              target: 'es2020',
            },
          },
        },
      },
    ],
  },
  plugins: [
    new FetchaloPlugin('./src/fetchalo.config.js'),
    new ModuleFederationPlugin(federationConfig('rspackHost')),
    new rspack.HtmlRspackPlugin({ template: './src/index.html' }),
    new rspack.DefinePlugin({
      'process.env.NODE_ENV': JSON.stringify('development'),
      __HOST_TITLE__: JSON.stringify('Rspack host'),
    }),
  ],
};
