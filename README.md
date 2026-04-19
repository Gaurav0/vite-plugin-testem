# vite-plugin-testem

[Vite](https://vite.dev/) plugin and [Testem](https://github.com/testem/testem) middleware helper for browser unit tests.

## Install

```bash
npm install vite-plugin-testem --save-dev
```

You must also install a compatible Vite version (peer dependency: `^7.0.0 || ^8.0.0`).

To run browser tests with Testem, install Testem in your project (optional peer dependency: `^3.20.0`):

```bash
npm install testem@^3.20.0 --save-dev
```

## `vitePluginTestem(options)`

Vite plugin that injects the Testem client script (`/testem.js`) into `index.html`. For TAP-style runners it can inject the usual `Testem.handleConsoleMessage` bridge.

**Options**

- `framework`: `'tap'` (default), `'mocha'`, or `'none'`
- `injectTapBridge`: override whether the TAP console bridge is injected (defaults to on when `framework === 'tap'`)

## `createTestemViteMiddleware(inlineConfig)`

Returns a Promise of `{ middleware, close }`. Use `middleware` in Testem’s `middleware` array so Vite runs in [middleware mode](https://vite.dev/guide/ssr.html#setting-up-the-dev-server) ahead of Testem’s own routes. The helper skips `/testem.js`, `/testem/*`, and `/socket.io` so Testem still serves its client and Socket.IO on the same origin.

Pass Vite `InlineConfig` fields as needed (for example `root: __dirname`). Set `configFile: false` if you do not want Vite to load `vite.config.js`.

## Recommended: `on_exit` and `close()`

Vite’s dev server registers file watchers and keeps resources open. If you only register the middleware and exit Testem, those handles can prevent the process from exiting cleanly or leave watcher noise in the background.

Call the `close()` function returned with the middleware from Testem’s **`on_exit`** hook. That shuts down the Vite server the same way as stopping the CLI dev server.

Example `testem.js`:

```javascript
const { createTestemViteMiddleware } = require('vite-plugin-testem');

let viteClose;

module.exports = async function testemConfig() {
  const { middleware, close } = await createTestemViteMiddleware({
    root: __dirname,
  });
  viteClose = close;

  return {
    middleware: [middleware],
    test_page: 'index.html',
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
```

## License

MIT
