'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs/promises');
const os = require('os');

const { vitePluginTestem, createTestemViteMiddleware } = require('..');

const PAGE_MARKER = 'SMOKE_PAGE_OK';

function assertHtmlInjection() {
  const tapHtml = vitePluginTestem().transformIndexHtml(
    '<html><head></head><body></body></html>',
  );
  assert.match(tapHtml, /\/testem\.js/);
  assert.match(tapHtml, /Testem\.handleConsoleMessage/);
  assert.match(tapHtml, /Testem\.emit\('tap'/);

  const mochaHtml = vitePluginTestem({ framework: 'mocha' }).transformIndexHtml(
    '<html><head></head><body></body></html>',
  );
  assert.match(mochaHtml, /\/testem\.js/);
  assert.doesNotMatch(mochaHtml, /handleConsoleMessage/);

  const existing =
    '<html><head><script src="/testem.js"></script></head><body></body></html>';
  assert.strictEqual(vitePluginTestem().transformIndexHtml(existing), existing);
}

function dispatch(handler, url) {
  return new Promise((resolve, reject) => {
    const headers = {};
    const chunks = [];
    let settled = false;
    const req = {
      method: 'GET',
      url,
      originalUrl: url,
      headers: { accept: 'text/html', host: '127.0.0.1' },
    };

    const finish = (nextCalled) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({
        nextCalled,
        url: req.url,
        statusCode: res.statusCode,
        body: Buffer.concat(chunks).toString('utf8'),
      });
    };

    const res = {
      statusCode: 200,
      headersSent: false,
      setHeader(name, value) {
        headers[name.toLowerCase()] = value;
      },
      getHeader(name) {
        return headers[name.toLowerCase()];
      },
      removeHeader(name) {
        delete headers[name.toLowerCase()];
      },
      hasHeader(name) {
        return Object.prototype.hasOwnProperty.call(headers, name.toLowerCase());
      },
      getHeaderNames() {
        return Object.keys(headers);
      },
      writeHead(code) {
        this.statusCode = code;
        this.headersSent = true;
        return this;
      },
      write(chunk) {
        if (chunk) {
          chunks.push(Buffer.from(chunk));
        }
        return true;
      },
      end(chunk) {
        if (chunk) {
          chunks.push(Buffer.from(chunk));
        }
        this.headersSent = true;
        finish(false);
      },
      on() {
        return this;
      },
      once() {
        return this;
      },
      emit() {
        return false;
      },
      removeListener() {
        return this;
      },
    };

    const timer = setTimeout(() => {
      reject(new Error(`timed out waiting for ${url} (rewritten to ${req.url})`));
    }, 8000);

    handler(req, res, () => finish(true));
  });
}

async function assertMiddlewareRouting() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vite-plugin-testem-'));
  await fs.writeFile(
    path.join(tmp, 'index.html'),
    `<html><head></head><body>${PAGE_MARKER}</body></html>`,
  );

  const { middleware, close } = await createTestemViteMiddleware({
    root: tmp,
    configFile: false,
    plugins: [vitePluginTestem()],
  });
  assert.strictEqual(typeof close, 'function');

  let handler;
  middleware({
    use(fn) {
      handler = fn;
    },
  });
  assert.strictEqual(typeof handler, 'function');

  try {
    for (const url of ['/123/index.html', '/-7/index.html']) {
      const result = await dispatch(handler, url);
      assert.strictEqual(result.nextCalled, false, url);
      assert.strictEqual(result.url, '/index.html', url);
      assert.strictEqual(result.statusCode, 200, url);
      assert.match(result.body, new RegExp(PAGE_MARKER), url);
      assert.match(result.body, /\/testem\.js/, url);
      assert.match(result.body, /Testem\.handleConsoleMessage/, url);
    }

    for (const url of ['/testem.js', '/testem/client.js', '/socket.io/?EIO=4']) {
      const result = await dispatch(handler, url);
      assert.strictEqual(result.nextCalled, true, url);
      assert.strictEqual(result.body, '', url);
    }
  } finally {
    await close();
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

async function main() {
  assert.strictEqual(typeof vitePluginTestem, 'function');
  assert.strictEqual(typeof createTestemViteMiddleware, 'function');

  const plugin = vitePluginTestem({ framework: 'mocha' });
  assert.strictEqual(plugin.name, 'testem');
  assert.strictEqual(typeof plugin.transformIndexHtml, 'function');

  assertHtmlInjection();
  await assertMiddlewareRouting();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
