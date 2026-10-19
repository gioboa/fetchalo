const webpack = require('webpack');
const HtmlWebPackPlugin = require('html-webpack-plugin');
const { ModuleFederationPlugin } = require('@module-federation/enhanced/webpack');
const { FetchaloPlugin } = require('fetchalo/webpack');
const federationConfig = require('./federation.config.js');

module.exports = {
  context: __dirname,
  entry: './src/index.js',
  output: { publicPath: 'auto', uniqueName: 'webpackHost' },
  resolve: { extensions: ['.jsx', '.js'] },
  // Served on every interface, so the page can be opened from a LAN address too
  // (an insecure context, where service workers are unavailable).
  devServer: {
    port: 8084,
    host: '0.0.0.0',
    allowedHosts: 'all',
    hot: false,
    liveReload: false,
    client: { overlay: false },
  },
  module: {
    rules: [{ test: /\.jsx?$/, exclude: /node_modules/, use: { loader: 'babel-loader' } }],
  },
  plugins: [
    // Every request to the origins in src/fetchalo.config.js carries its headers.
    new FetchaloPlugin('./src/fetchalo.config.js'),
    new ModuleFederationPlugin(federationConfig('webpackHost')),
    new HtmlWebPackPlugin({ template: './src/index.html' }),
    new webpack.DefinePlugin({ __HOST_TITLE__: JSON.stringify('webpack host') }),
  ],
};
