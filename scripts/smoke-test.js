'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs/promises');
const os = require('os');

const { vitePluginTestem, createTestemViteMiddleware } = require('..');

async function main() {
  assert.strictEqual(typeof vitePluginTestem, 'function');
  assert.strictEqual(typeof createTestemViteMiddleware, 'function');

  const plugin = vitePluginTestem({ framework: 'mocha' });
  assert.strictEqual(plugin.name, 'testem');
  assert.strictEqual(typeof plugin.transformIndexHtml, 'function');

  const htmlOut = plugin.transformIndexHtml(
    '<html><head></head><body></body></html>',
  );
  assert.match(htmlOut, /\/testem\.js/);

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vite-plugin-testem-'));
  try {
    const { close } = await createTestemViteMiddleware({
      root: tmp,
      configFile: false,
    });
    assert.strictEqual(typeof close, 'function');
    await close();
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
