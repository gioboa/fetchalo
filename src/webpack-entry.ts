// Prepended to every entry by the webpack/Rspack plugin. ES modules evaluate in
// import order: fetchalo is installed before es-module-shims reads `esmsInitOptions`.
import './webpack-setup';
import 'es-module-shims';
