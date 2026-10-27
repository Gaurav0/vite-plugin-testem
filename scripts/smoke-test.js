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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntil(predicate, timeout, message) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      assert.fail(message);
    }
    await delay(50);
  }
}

function captureServerPlugin() {
  const captured = {
    server: null,
    plugin: {
      name: 'capture-server',
      configureServer(server) {
        captured.server = server;
      },
    },
  };
  return captured;
}

function countPaths(paths, suffix) {
  return paths.filter((file) => file.endsWith(suffix)).length;
}

async function whenWatcherSees(watcher, root) {
  const wanted = path.resolve(root);
  await waitUntil(
    () => Object.keys(watcher.getWatched()).some((dir) => path.resolve(dir) === wanted),
    4000,
    `Vite watcher did not see ${root}`,
  );
}

async function openMiddleware(root, plugins = []) {
  const captured = captureServerPlugin();
  const handle = await createTestemViteMiddleware({
    root,
    configFile: false,
    // HTML requests otherwise start a dep scan that can outlive server.close().
    optimizeDeps: { noDiscovery: true },
    plugins: [captured.plugin, ...plugins],
  });
  assert.ok(captured.server, 'configureServer should capture the Vite server');
  return {
    middleware: handle.middleware,
    close: handle.close,
    watcher: captured.server.watcher,
  };
}

async function assertMiddlewareRouting() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vite-plugin-testem-'));
  await fs.writeFile(
    path.join(tmp, 'index.html'),
    `<html><head></head><body>${PAGE_MARKER}</body></html>`,
  );

  const { middleware, close, watcher } = await openMiddleware(tmp, [vitePluginTestem()]);
  assert.strictEqual(typeof close, 'function');

  let handler;
  const exits = [];
  middleware({
    use(fn) {
      handler = fn;
    },
  }, null, {
    onExit(fn) {
      exits.push(fn);
    },
  });
  assert.strictEqual(typeof handler, 'function');
  assert.strictEqual(exits.length, 1);

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

    assert.strictEqual(watcher.closed, false);
    await exits[0]();
    assert.strictEqual(watcher.closed, true, 'onExit should close the Vite server');
  } finally {
    await close();
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

async function waitForAnother(paths, suffix, previous, label) {
  await waitUntil(
    () => countPaths(paths, suffix) > previous,
    4000,
    `${label}, got ${paths.join(', ')}`,
  );
  return countPaths(paths, suffix);
}

async function assertWatcherHandoff() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vite-plugin-testem-watch-'));
  const file = path.join(tmp, 'keep.js');
  const added = path.join(tmp, 'added.js');
  await fs.writeFile(file, '1\n');

  let dev;
  let ci;
  try {
    dev = await openMiddleware(tmp);
    const changes = [];
    let released = false;
    dev.middleware({ use() {} }, null, {
      onExit() {},
      watching: true,
      singleRun: false,
      notifyFileChange(changed) {
        changes.push(changed);
      },
      releaseFileWatcher() {
        released = true;
      },
    });
    assert.strictEqual(released, true);
    await whenWatcherSees(dev.watcher, tmp);
    assert.strictEqual(dev.watcher.closed, false);

    const keepBefore = countPaths(changes, 'keep.js');
    await fs.writeFile(file, '2\n');
    await waitForAnother(changes, 'keep.js', keepBefore, 'expected a change event for keep.js');

    const addedBefore = countPaths(changes, 'added.js');
    await fs.writeFile(added, 'export {}\n');
    const addedAfterCreate = await waitForAnother(
      changes,
      'added.js',
      addedBefore,
      'expected an add event for added.js',
    );
    await fs.rm(added);
    await waitForAnother(
      changes,
      'added.js',
      addedAfterCreate,
      'expected an unlink event for added.js',
    );
    await dev.close();

    ci = await openMiddleware(tmp);
    const ciChanges = [];
    let ciReleased = false;
    ci.middleware({ use() {} }, null, {
      onExit() {},
      watching: true,
      singleRun: true,
      notifyFileChange(changed) {
        ciChanges.push(changed);
      },
      releaseFileWatcher() {
        ciReleased = true;
      },
    });
    assert.strictEqual(ciReleased, false);
    await waitUntil(
      () => ci.watcher.closed,
      4000,
      'single run should close the Vite watcher',
    );
    await fs.writeFile(file, '3\n');
    await delay(200);
    assert.deepStrictEqual(ciChanges, []);
  } finally {
    if (dev) {
      await dev.close();
    }
    if (ci) {
      await ci.close();
    }
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

async function assertWatchingDisabled() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vite-plugin-testem-nowatch-'));
  const file = path.join(tmp, 'keep.js');
  await fs.writeFile(file, '1\n');

  const paused = await openMiddleware(tmp);
  const changes = [];
  let released = false;
  let sawChange = false;
  try {
    paused.middleware({ use() {} }, null, {
      onExit() {},
      watching: false,
      singleRun: false,
      notifyFileChange(changed) {
        changes.push(changed);
      },
      releaseFileWatcher() {
        released = true;
      },
    });
    assert.strictEqual(released, false);
    assert.strictEqual(paused.watcher.closed, false);
    await whenWatcherSees(paused.watcher, tmp);
    paused.watcher.on('change', (changed) => {
      if (changed.endsWith('keep.js')) {
        sawChange = true;
      }
    });
    await fs.writeFile(file, '2\n');
    await waitUntil(
      () => sawChange,
      4000,
      'disable_watching should leave the Vite watcher open',
    );
    await delay(200);
    assert.deepStrictEqual(changes, []);
    assert.strictEqual(paused.watcher.closed, false);
  } finally {
    await paused.close();
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

async function assertMiddlewareWithoutHooks() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vite-plugin-testem-nohooks-'));
  const file = path.join(tmp, 'keep.js');
  await fs.writeFile(file, '1\n');

  const bare = await openMiddleware(tmp);
  let sawChange = false;
  try {
    bare.middleware({ use() {} });
    bare.middleware({ use() {} }, null);
    assert.strictEqual(bare.watcher.closed, false);
    await whenWatcherSees(bare.watcher, tmp);
    bare.watcher.on('change', (changed) => {
      if (changed.endsWith('keep.js')) {
        sawChange = true;
      }
    });
    await fs.writeFile(file, '2\n');
    await waitUntil(
      () => sawChange,
      4000,
      'middleware without hooks should leave the Vite watcher open',
    );
    await bare.close();
    assert.strictEqual(bare.watcher.closed, true);
  } finally {
    await bare.close();
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
  await assertWatcherHandoff();
  await assertWatchingDisabled();
  await assertMiddlewareWithoutHooks();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
