'use strict';

const fs = require('fs/promises');
const path = require('path');
const vite = require('vite');

/**
 * Vite plugin for projects tested with [Testem](https://github.com/testem/testem).
 *
 * Injects the Testem browser client (`/testem.js`) into `index.html`. For `framework: 'tap'`,
 * also injects the usual `Testem.handleConsoleMessage` bridge so tape / TAP output reaches Testem.
 * For Mocha, QUnit, etc., omit the TAP bridge (use `framework: 'mocha'` or `injectTapBridge: false`).
 *
 * @param {{ framework?: 'tap' | 'mocha' | 'none', injectTapBridge?: boolean }} [options]
 * @returns {import('vite').Plugin}
 */
function vitePluginTestem(options = {}) {
  const framework = options.framework || 'tap';
  const injectTapBridge =
    options.injectTapBridge !== undefined
      ? options.injectTapBridge
      : framework === 'tap';

  return {
    name: 'testem',
    enforce: 'pre',
    transformIndexHtml(html) {
      if (/\/testem\.js/.test(html)) {
        return html;
      }
      let snippet = '<script src="/testem.js"></script>';
      if (injectTapBridge) {
        snippet += `
<script>
Testem.handleConsoleMessage = function (msg) {
  Testem.emit('tap', msg);
  return false;
};
</script>`;
      }
      if (/<head[^>]*>/i.test(html)) {
        return html.replace(/<head[^>]*>/i, (m) => `${m}\n${snippet}\n`);
      }
      return `${snippet}\n${html}`;
    },
  };
}

/**
 * Creates Express middleware (for Testem `middleware:`) that forwards requests to Vite in middleware mode.
 * Strips Testem’s per-browser session prefix (`/:id/…`) so Vite resolves paths from the project root.
 * Transforms `*.html` with `server.transformIndexHtml` so plugins such as `vitePluginTestem` run.
 * `appType: 'custom'` stays in place so a missing file falls through to Testem instead of Vite’s 404.
 * Skips `/testem.js`, `/testem/*`, and `/socket.io` so Testem’s own routes run later in the stack.
 *
 * @param {import('vite').InlineConfig} [inlineConfig] merged after defaults; set `configFile: false` to skip loading `vite.config.js`
 * @returns {Promise<{ middleware: (app: import('express').Application) => void, close: () => Promise<void> }>}
 */
async function createTestemViteMiddleware(inlineConfig = {}) {
  const cwd = inlineConfig.root || inlineConfig.cwd || process.cwd();
  const configFile =
    inlineConfig.configFile !== undefined
      ? inlineConfig.configFile
      : path.join(cwd, 'vite.config.js');

  const base = vite.mergeConfig(
    {
      configFile,
      root: cwd,
      server: {
        middlewareMode: true,
        hmr: false,
        appType: 'custom',
      },
    },
    { ...inlineConfig, cwd: undefined },
  );

  const server = await vite.createServer(base);

  function middleware(app) {
    app.use((req, res, next) => {
      let url = req.url;
      const qIdx = url.indexOf('?');
      const pathPart = qIdx === -1 ? url : url.slice(0, qIdx);
      const queryPart = qIdx === -1 ? '' : url.slice(qIdx);
      // Testem opens the runner under /:id/… (browser session). Strip it so Vite resolves files
      // from project root (same path layout as bare /tests_run.html).
      const withPath = pathPart.match(/^\/-?\d+\/(.+)$/);
      const idOnly = pathPart.match(/^\/-?\d+$/);
      if (withPath) {
        req.url = `/${withPath[1]}${queryPart}`;
        url = req.url;
      } else if (idOnly) {
        req.url = `/${queryPart}`;
        url = req.url;
      }

      const pathname = url.split('?')[0];
      if (
        pathname === '/testem.js' ||
        pathname.startsWith('/testem/') ||
        pathname.startsWith('/socket.io')
      ) {
        return next();
      }

      if (pathname.endsWith('.html')) {
        const rootPath = path.resolve(cwd);
        const filePath = path.resolve(rootPath, pathname.slice(1));
        const relative = path.relative(rootPath, filePath);
        if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
          fs.readFile(filePath, 'utf8')
            .then((html) => server.transformIndexHtml(url, html))
            .then((html) => {
              res.statusCode = 200;
              res.setHeader('Content-Type', 'text/html; charset=utf-8');
              res.end(html);
            })
            .catch((err) => {
              if (err && err.code === 'ENOENT') {
                return server.middlewares(req, res, next);
              }
              return next(err);
            });
          return;
        }
      }

      server.middlewares(req, res, next);
    });
  }

  return {
    middleware,
    close: () => server.close(),
  };
}

module.exports = {
  vitePluginTestem,
  createTestemViteMiddleware,
};
