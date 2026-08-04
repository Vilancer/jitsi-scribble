#!/usr/bin/env node
// The full verdaccio publish-shape proof (ROADMAP Phase 2 success criterion 5).
//
// Starts an isolated local verdaccio instance bound to http://localhost:4873
// ONLY (never the public npm registry — see this plan's threat model,
// T-02-04-01), builds and publishes @vilancer/protocol to it, installs
// the published tarball into a scratch location, then for every one of the
// 5 export subpaths (., ./codec, ./schema, ./geometry, ./transport) runs a
// real dynamic import() under BOTH the default Node conditions and
// --conditions=react-native (10 resolutions total), asserting each resolves
// to a real file exporting real Wave-2 content rather than throwing or
// resolving to a placeholder.
//
// Idempotent: wipes its own isolated storage/scratch directories before AND
// after every run, so a second (or third) invocation never trips over stale
// verdaccio state from a prior run.

import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PROTOCOL_DIR = resolve(SCRIPT_DIR, '..'); // packages/protocol
const REPO_ROOT = resolve(PROTOCOL_DIR, '../..'); // jitsi-scribble/ workspace root

const REGISTRY = 'http://localhost:4873';
const VERDACCIO_TMP = resolve(REPO_ROOT, '.verdaccio-tmp');
const STORAGE_DIR = resolve(VERDACCIO_TMP, 'storage');
const CONFIG_PATH = resolve(VERDACCIO_TMP, 'config.yml');
const NPMRC_PATH = resolve(VERDACCIO_TMP, '.npmrc');
const SCRATCH_INSTALL_DIR = resolve(VERDACCIO_TMP, 'scratch-install');
const CHECKER_PATH = resolve(SCRATCH_INSTALL_DIR, 'checker.mjs');

// One representative REAL (non-placeholder) export per subpath — proves the
// resolved module carries actual Wave-2 content, not __PLACEHOLDER__.
const SUBPATH_CHECKS = [
  { specifier: '@vilancer/protocol', expectedKey: 'encode' },
  { specifier: '@vilancer/protocol/codec', expectedKey: 'encode' },
  { specifier: '@vilancer/protocol/schema', expectedKey: 'WireFrameSchema' },
  { specifier: '@vilancer/protocol/geometry', expectedKey: 'contentRect' },
  { specifier: '@vilancer/protocol/transport', expectedKey: 'MemoryTransport' },
];

const CONDITIONS = [
  { name: 'default', nodeArgs: [] },
  { name: 'react-native', nodeArgs: ['--conditions=react-native'] },
];

const CHECKER_SOURCE = `
const [, , importSpecifier, expectedKey] = process.argv;
try {
  const mod = await import(importSpecifier);
  if (mod === undefined || mod === null) {
    console.log(JSON.stringify({ ok: false, reason: 'module resolved to undefined/null' }));
    process.exit(1);
  }
  if (!(expectedKey in mod)) {
    console.log(JSON.stringify({ ok: false, reason: 'missing expected export ' + expectedKey }));
    process.exit(1);
  }
  const value = mod[expectedKey];
  if (value === undefined || value === '__PLACEHOLDER__') {
    console.log(JSON.stringify({ ok: false, reason: 'export is placeholder or undefined' }));
    process.exit(1);
  }
  console.log(JSON.stringify({ ok: true }));
  process.exit(0);
} catch (err) {
  console.log(JSON.stringify({ ok: false, reason: String((err && err.message) || err) }));
  process.exit(1);
}
`;

let verdaccioProc = null;

function log(msg) {
  console.log(msg);
}

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { stdio: 'pipe', encoding: 'utf8', ...opts });
}

function cleanTmp() {
  rmSync(VERDACCIO_TMP, { recursive: true, force: true });
}

async function waitForRegistry(url, timeoutMs = 20000) {
  const start = Date.now();
  let lastErr;
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      // verdaccio's root route always responds (200 for the web UI, or a
      // JSON error) once it's actually listening.
      if (res) return;
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`verdaccio did not become ready at ${url} within ${timeoutMs}ms: ${lastErr}`);
}

function stopVerdaccio() {
  if (verdaccioProc && !verdaccioProc.killed) {
    verdaccioProc.kill('SIGTERM');
  }
  verdaccioProc = null;
}

async function checkResolution(specifier, expectedKey, condition) {
  try {
    const stdout = run('node', [...condition.nodeArgs, CHECKER_PATH, specifier, expectedKey], {
      cwd: SCRATCH_INSTALL_DIR,
    });
    const result = JSON.parse(stdout.trim().split('\n').pop());
    return result;
  } catch (err) {
    // execFileSync throws on nonzero exit; the checker still printed JSON to
    // stdout before exiting nonzero.
    const stdout = err.stdout ? err.stdout.toString().trim() : '';
    if (stdout) {
      try {
        return JSON.parse(stdout.split('\n').pop());
      } catch {
        /* fall through to generic failure below */
      }
    }
    return { ok: false, reason: String(err.message || err) };
  }
}

async function main() {
  cleanTmp();
  mkdirSync(STORAGE_DIR, { recursive: true });
  mkdirSync(SCRATCH_INSTALL_DIR, { recursive: true });

  try {
    log('==> building @vilancer/protocol (nx build protocol)');
    run('pnpm', ['nx', 'build', 'protocol'], { cwd: REPO_ROOT });

    log('==> writing isolated verdaccio config (storage: ' + STORAGE_DIR + ')');
    writeFileSync(
      CONFIG_PATH,
      [
        `storage: ${STORAGE_DIR}`,
        // Proxy-only uplink so a transitive dependency (e.g. effect) that
        // isn't published to this throwaway local registry can still be
        // resolved for the scratch install below — publishing itself is
        // scoped to this local registry only (never the public registry,
        // see T-02-04-01); reading from npmjs as an uplink is unrelated to
        // that threat.
        `uplinks:`,
        `  npmjs:`,
        `    url: https://registry.npmjs.org/`,
        `packages:`,
        `  '@vilancer/protocol':`,
        `    access: $all`,
        `    publish: $all`,
        `    unpublish: $all`,
        `  '**':`,
        `    access: $all`,
        `    publish: $all`,
        `    unpublish: $all`,
        `    proxy: npmjs`,
        `log:`,
        `  type: stdout`,
        `  format: pretty`,
        `  level: warn`,
        `publish:`,
        `  allow_offline: true`,
        '',
      ].join('\n'),
    );

    // A fake auth token so the npm CLI doesn't refuse to attempt the publish
    // locally; verdaccio's access:$all / publish:$all accepts any
    // authenticated-looking request against this throwaway local registry.
    writeFileSync(
      NPMRC_PATH,
      [`registry=${REGISTRY}/`, `//localhost:4873/:_authToken="local-verdaccio-test-token"`, ''].join('\n'),
    );

    log(`==> starting isolated local verdaccio at ${REGISTRY} (never the public npm registry)`);
    verdaccioProc = spawn('pnpm', ['exec', 'verdaccio', '--config', CONFIG_PATH, '--listen', '4873'], {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    verdaccioProc.stdout.on('data', () => {});
    verdaccioProc.stderr.on('data', () => {});
    verdaccioProc.on('error', (err) => {
      console.error('verdaccio process error:', err);
    });

    await waitForRegistry(REGISTRY);

    log('==> publishing @vilancer/protocol to the local registry ONLY');
    run('npm', ['publish', '--registry', REGISTRY, '--userconfig', NPMRC_PATH], { cwd: PROTOCOL_DIR });

    log('==> installing the published tarball into a scratch location');
    writeFileSync(
      resolve(SCRATCH_INSTALL_DIR, 'package.json'),
      JSON.stringify({ name: 'verify-publish-shape-scratch', version: '0.0.0', private: true, type: 'module' }, null, 2),
    );
    run(
      'npm',
      ['install', '@vilancer/protocol', '--registry', REGISTRY, '--userconfig', NPMRC_PATH, '--no-save'],
      { cwd: SCRATCH_INSTALL_DIR },
    );
    writeFileSync(CHECKER_PATH, CHECKER_SOURCE);

    log('==> resolving all 5 subpaths under both default and react-native conditions (10 total)');
    const results = [];
    for (const condition of CONDITIONS) {
      for (const { specifier, expectedKey } of SUBPATH_CHECKS) {
        const result = await checkResolution(specifier, expectedKey, condition);
        results.push({ specifier, condition: condition.name, ...result });
        const line = `${result.ok ? 'PASS' : 'FAIL'}: ${specifier} [conditions=${condition.name}]`;
        console.log(result.ok ? line : `${line} — ${result.reason}`);
      }
    }

    const failures = results.filter((r) => !r.ok);
    if (failures.length > 0) {
      console.error(`\n${failures.length}/${results.length} resolutions FAILED.`);
      process.exitCode = 1;
    } else {
      console.log(`\nPASS: all ${results.length}/10 subpath/condition resolutions succeeded.`);
    }
  } finally {
    stopVerdaccio();
    cleanTmp();
  }
}

main().catch((err) => {
  console.error('verify-publish-shape.mjs failed:', err);
  stopVerdaccio();
  cleanTmp();
  process.exitCode = 1;
});
