'use strict';

const { vitePluginTestem } = require('vite-plugin-testem');

const framework = process.env.TESTEM_FRAMEWORK === 'tap' ? 'tap' : 'none';

module.exports = {
  plugins: [vitePluginTestem({ framework })],
};
