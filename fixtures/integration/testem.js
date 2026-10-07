'use strict';

const { createTestemViteMiddleware } = require('vite-plugin-testem');

let viteClose;

module.exports = async function testemConfig() {
  const { middleware, close } = await createTestemViteMiddleware({
    root: __dirname,
  });
  viteClose = close;

  const tap = process.env.TESTEM_FRAMEWORK === 'tap';

  return {
    framework: tap ? 'tap' : 'custom',
    test_page: tap ? 'tap.html' : 'adapter.html',
    launch_in_ci: ['Headless Chrome'],
    disable_watching: true,
    timeout: 20,
    browser_start_timeout: 30,
    // Headless Chrome on Testem 3.20 and 4.0.0-beta.1 does not pass --no-sandbox.
    browser_args: {
      'Headless Chrome': ['--no-sandbox'],
    },
    middleware: [middleware],
    on_exit(config, data, callback) {
      if (!viteClose) {
        return callback(null);
      }
      viteClose()
        .then(() => callback(null))
        .catch(callback);
    },
  };
};
