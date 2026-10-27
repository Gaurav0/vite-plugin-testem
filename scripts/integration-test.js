'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const version = process.env.TESTEM_VERSION || '3.20.0';
const fixture = path.join(__dirname, '..', 'fixtures', 'integration');

if (!/^[0-9A-Za-z.+-]+$/.test(version)) {
  console.error(`Invalid TESTEM_VERSION: ${version}`);
  process.exit(1);
}

function run(args, extraEnv) {
  const result = spawnSync('npm', args, {
    cwd: fixture,
    stdio: 'inherit',
    env: { ...process.env, ...extraEnv },
  });
  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

// Node 20.19 ships npm 10.8.2. Installing this fixture (Vite's optional
// platform packages, via file:../..) crashes that npm on Linux:
// "Cannot read properties of null (reading 'edgesOut')". npm 10.9 fixed it.
// https://github.com/npm/cli/issues/4828
function npmOlderThan109() {
  const result = spawnSync('npm', ['--version'], { encoding: 'utf8' });
  const parts = (result.stdout || '').trim().split('.').map((part) => parseInt(part, 10));
  const major = parts[0];
  const minor = parts[1];
  return !Number.isFinite(major) || major < 10 || (major === 10 && minor < 9);
}

function runInstall(args) {
  if (!npmOlderThan109()) {
    return run(args);
  }
  const result = spawnSync('npx', ['--yes', 'npm@10.9.2', ...args], {
    cwd: fixture,
    stdio: 'inherit',
    env: process.env,
  });
  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

runInstall(['install', '--no-package-lock']);
runInstall(['install', '--no-save', '--no-package-lock', `testem@${version}`]);

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
  process.exit(1);
}

console.log(`custom adapter against testem@${version}`);
run(['exec', '--', 'testem', 'ci'], { TESTEM_FRAMEWORK: 'custom' });

console.log(`TAP against testem@${version}`);
run(['exec', '--', 'testem', 'ci'], { TESTEM_FRAMEWORK: 'tap' });
