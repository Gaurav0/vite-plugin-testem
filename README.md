# vite-plugin-testem

[Vite](https://vite.dev/) plugin and [Testem](https://github.com/testem/testem) middleware helper for browser unit tests.

## Install

```bash
npm install vite-plugin-testem --save-dev
```

Node.js `^20.19.0 || ^22.12.0 || ^24.0.0 || >=26.0.0` is required.

You must also install a compatible Vite version (peer dependency: `^7.0.0 || ^8.0.0`).

To run browser tests with Testem, install Testem in your project (optional peer dependency: `^3.20.0 || ^4.0.0-beta.1`):

```bash
npm install testem@^3.20.0 --save-dev
# or, on Node ^22.17.0 || ^24.0.0 || >=26.0.0:
npm install testem@^4.0.0-beta.1 --save-dev
```

## `vitePluginTestem(options)`

Vite plugin that injects the Testem client script (`/testem.js`) into `index.html`. For TAP-style runners it can inject the usual `Testem.handleConsoleMessage` bridge.

**Options**

- `framework`: `'tap'` (default), `'mocha'`, or `'none'`
- `injectTapBridge`: override whether the TAP console bridge is injected (defaults to on when `framework === 'tap'`)

## `createTestemViteMiddleware(inlineConfig)`

Returns a Promise of `{ middleware, close }`. Use `middleware` in Testem’s `middleware` array so Vite runs in [middleware mode](https://vite.dev/guide/ssr.html#setting-up-the-dev-server) ahead of Testem’s own routes. The helper skips `/testem.js`, `/testem/*`, and `/socket.io` so Testem still serves its client and Socket.IO on the same origin.

Pass Vite `InlineConfig` fields as needed (for example `root: __dirname`). Set `configFile: false` if you do not want Vite to load `vite.config.js`.

## Shutdown

`createTestemViteMiddleware()` returns `{ middleware, close }`.

When Testem calls `middleware(app, httpServer, hooks)` and `hooks.onExit` is a function, the helper registers `close()` there. Testem runs that when it stops the server, so you do not add an `on_exit` hook. `close()` is safe to call again if an older config still invokes it from `on_exit`.

Testem builds that only pass the Express app, or the app and the HTTP server, do not provide `hooks.onExit`. Keep calling `close()` from **`on_exit`** so the Vite watcher does not stay open after Testem exits:

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

## Development

`npm test` runs the smoke test. It does not need Testem or a browser.

`npm run test:integration` installs Testem into `fixtures/integration` and runs headless Chrome. `TESTEM_VERSION` defaults to `3.20.0`. Testem 4 needs Chrome and Node `^22.17.0 || ^24.0.0 || >=26.0.0`:

```bash
TESTEM_VERSION=4.0.0-beta.1 npm run test:integration
```

## License

MIT
