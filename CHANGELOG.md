# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.2] - 2026-10-07

### Changed

- Optional `testem` peer range is now `^3.20.0 || ^4.0.0-beta.1`. `^4.0.0` does not match `4.0.0-beta.1`.
- Node.js engines are `^20.19.0 || ^22.12.0 || ^24.0.0 || >=26.0.0`. Node 25 is not supported.

### Fixed

- **`createTestemViteMiddleware`:** Transform `*.html` with Vite so `vitePluginTestem` injection runs in middleware mode. `appType` stays `custom`, so paths Vite does not serve still fall through to Testem.

## [1.0.1] - 2026-04-19

### Fixed

- **`createTestemViteMiddleware`:** Strip Testem’s per-browser URL prefix (`/<sessionId>/…`) before forwarding to Vite so the runner page and assets resolve correctly when Testem opens `/:id/tests_run.html` (fixes “testem.js not loaded” / connection timeout in CI).

## [1.0.0] - 2026-04-19

First stable release: Vite plugin and Testem middleware helper for browser tests.

### Install

```bash
npm install vite-plugin-testem --save-dev
```

Install a compatible **Vite** version (peer dependency: `^7.0.0 || ^8.0.0`). To run browser tests with Testem, install **Testem** (optional peer: `^3.20.0`):

```bash
npm install testem@^3.20.0 --save-dev
```

### Links

- **npm:** [vite-plugin-testem](https://www.npmjs.com/package/vite-plugin-testem)
- **Docs:** [README on GitHub](https://github.com/Gaurav0/vite-plugin-testem#readme)
