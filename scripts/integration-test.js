'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const version = process.env.TESTEM_VERSION || '3.20.0';
const viteVersion = process.env.VITE_VERSION || '';
const repoRoot = path.join(__dirname, '..');
const fixture = path.join(repoRoot, 'fixtures', 'integration');
// Set when this run replaces the repo's Vite. Restored with npm ci so
// later npm test still uses the lockfile's Vite 8.
let restoreRoot = false;

if (!/^[0-9A-Za-z.+-]+$/.test(version)) {
  console.error(`Invalid TESTEM_VERSION: ${version}`);
  process.exit(1);
}
if (viteVersion && !/^[0-9A-Za-z.+-]+$/.test(viteVersion)) {
  console.error(`Invalid VITE_VERSION: ${viteVersion}`);
  process.exit(1);
}

function run(args, extraEnv, cwd = fixture) {
  const result = spawnSync('npm', args, {
    cwd,
    stdio: 'inherit',
    env: { ...process.env, ...extraEnv },
  });
  if (result.error) {
    console.error(result.error);
    exit(1);
  }
  if (result.status !== 0) {
    exit(result.status || 1);
  }
}

function exit(status) {
  restoreRootVite();
  process.exit(status);
}

function installedViteVersion(cwd) {
  const pkgPath = path.join(cwd, 'node_modules', 'vite', 'package.json');
  if (!fs.existsSync(pkgPath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version;
}

function viteMatches(spec, installed) {
  if (!installed) {
    return false;
  }
  if (/^\d+$/.test(spec)) {
    return installed.split('.')[0] === spec;
  }
  return installed === spec || installed.startsWith(`${spec}.`);
}

// file:../.. loads this repo's index.js, and Node resolves require('vite')
// from that real path. Swap the root copy after the fixture install. Doing
// it earlier makes npm walk into this repo and crash while installing Vite 8
// (edgesOut). The fixture's own Vite is not the copy the plugin runs.
function installRootVite(spec) {
  const current = installedViteVersion(repoRoot);
  if (!current) {
    console.error('Vite is not installed at the repo root. Run npm ci and retry.');
    process.exit(1);
  }
  restoreRoot = true;
  runInstall(['install', '--no-save', '--no-package-lock', `vite@${spec}`], repoRoot);
}

function restoreRootVite() {
  if (!restoreRoot) {
    return;
  }
  restoreRoot = false;
  console.log('restoring Vite from the lockfile');
  runInstall(['ci'], repoRoot);
}

function assertPluginVite(spec) {
  const pluginEntry = fs.realpathSync(
    path.join(fixture, 'node_modules', 'vite-plugin-testem', 'index.js'),
  );
  const resolved = require.resolve('vite/package.json', {
    paths: [path.dirname(pluginEntry)],
  });
  const installed = JSON.parse(fs.readFileSync(resolved, 'utf8')).version;
  if (!viteMatches(spec, installed)) {
    console.error(`Expected Vite ${spec} but the plugin resolved ${installed} (${resolved})`);
    exit(1);
  }
  return installed;
}

// Node 20.19 ships npm 10.8.2. Installing this fixture crashes that npm,
// and npm 10.9.2 still crashes in arborist while loading Vite's peer set
// ("Cannot read properties of null (reading 'edgesOut')"). npm 11 does not.
// https://github.com/npm/cli/issues/4828
function npmOlderThan109() {
  const result = spawnSync('npm', ['--version'], { encoding: 'utf8' });
  const parts = (result.stdout || '').trim().split('.').map((part) => parseInt(part, 10));
  const major = parts[0];
  const minor = parts[1];
  return !Number.isFinite(major) || major < 10 || (major === 10 && minor < 9);
}

function runInstall(args, cwd = fixture) {
  if (!npmOlderThan109()) {
    return run(args, undefined, cwd);
  }
  const result = spawnSync('npx', ['--yes', 'npm@11.6.2', ...args], {
    cwd,
    stdio: 'inherit',
    env: process.env,
  });
  if (result.error) {
    console.error(result.error);
    exit(1);
  }
  if (result.status !== 0) {
    exit(result.status || 1);
  }
}

runInstall(['install', '--no-package-lock']);
runInstall(['install', '--no-save', '--no-package-lock', `testem@${version}`]);
if (viteVersion) {
  installRootVite(viteVersion);
}
const resolvedVite = viteVersion
  ? assertPluginVite(viteVersion)
  : installedViteVersion(repoRoot);

// Run outside the fixture so Testem does not load testem.js. That config
// starts Vite, and `testem launchers` never calls on_exit to close it.
const launchersDir = fs.mkdtempSync(
  path.join(os.tmpdir(), 'vite-plugin-testem-launchers-'),
);
const testemBin = path.join(fixture, 'node_modules', '.bin', 'testem');
const launchers = spawnSync(testemBin, ['launchers'], {
  cwd: launchersDir,
  encoding: 'utf8',
  timeout: 30000,
});
fs.rmSync(launchersDir, { recursive: true, force: true });
const launcherOutput = `${launchers.stdout || ''}${launchers.stderr || ''}`;
if (launchers.status !== 0 || !launcherOutput.includes('Headless Chrome')) {
  if (launchers.error) {
    console.error(launchers.error);
  }
  console.error(launcherOutput);
  console.error('Headless Chrome is not available. Install Chrome and retry.');
  exit(1);
}

console.log(`custom adapter against testem@${version} vite@${resolvedVite}`);
run(['exec', '--', 'testem', 'ci'], { TESTEM_FRAMEWORK: 'custom' });

console.log(`TAP against testem@${version} vite@${resolvedVite}`);
run(['exec', '--', 'testem', 'ci'], { TESTEM_FRAMEWORK: 'tap' });
exit(0);
