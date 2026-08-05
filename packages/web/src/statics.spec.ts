// Static safety checks (WEB-09, privacy) — no new tooling, ordinary vitest
// assertions over the file tree and package.json produced by Task 1.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC_ROOT = __dirname;
const PACKAGE_JSON_PATH = join(SRC_ROOT, '..', 'package.json');

/** Import-statement/require patterns for a UI component framework or its
 * DOM-renderer counterpart. WEB-09 forbids the web package from ever
 * depending on one — this file is a static tripwire against a regression. */
const UI_FRAMEWORK_IMPORT_PATTERNS: readonly RegExp[] = [
  /from\s+['"]react['"]/,
  /from\s+['"]react-dom(\/.*)?['"]/,
  /from\s+['"]vue['"]/,
  /from\s+['"]svelte['"]/,
  /from\s+['"]preact(\/.*)?['"]/,
  /from\s+['"]@angular\/core['"]/,
  /from\s+['"]solid-js(\/.*)?['"]/,
  /from\s+['"]lit['"]/,
  /from\s+['"]lit-html['"]/,
  /require\(\s*['"]react(-dom)?['"]\s*\)/,
];

/** The matching package.json dependency-key vocabulary for the same
 * frameworks. */
const UI_FRAMEWORK_PACKAGE_KEYS: readonly string[] = [
  'react',
  'react-dom',
  'vue',
  'svelte',
  'preact',
  '@angular/core',
  'solid-js',
  'lit',
  'lit-html',
];

/** Persistent (disk-backed, survives-a-reload) browser storage APIs. The
 * phase's privacy property is that stroke/participant data is never written
 * to any such mechanism — this is a static tripwire against a regression,
 * not the only enforcement of that property. */
const PERSISTENT_STORAGE_PATTERNS: readonly RegExp[] = [
  /\blocalStorage\b/,
  /\bsessionStorage\b/,
  /\bindexedDB\b/,
  /document\.cookie/,
  /\bopenDatabase\b/,
];

/** Recursively collects every `.ts` file under `dir`, excluding the
 * `test-support` fixtures directory (per this task's own scope) and
 * `node_modules` should one ever appear underneath `src`. */
function collectTsFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const rel = relative(SRC_ROOT, fullPath);
    if (rel === 'test-support' || rel.startsWith(`test-support${'/'}`) || entry === 'node_modules') continue;
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...collectTsFiles(fullPath));
    } else if (entry.endsWith('.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

const files = collectTsFiles(SRC_ROOT);

describe('static safety checks — no UI framework, no persistent stroke storage', () => {
  it('scans at least one real source file (sanity check the walk itself found something)', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('no file under packages/web/src (excluding test-support) imports a UI component framework (WEB-09)', () => {
    for (const file of files) {
      const content = readFileSync(file, 'utf-8');
      for (const pattern of UI_FRAMEWORK_IMPORT_PATTERNS) {
        expect(
          pattern.test(content),
          `${relative(SRC_ROOT, file)} matched forbidden UI-framework import pattern ${pattern}`,
        ).toBe(false);
      }
    }
  });

  it("packages/web/package.json's dependencies declare no UI component framework (WEB-09)", () => {
    const pkg = JSON.parse(readFileSync(PACKAGE_JSON_PATH, 'utf-8')) as { dependencies?: Record<string, string> };
    const deps = Object.keys(pkg.dependencies ?? {});
    for (const forbidden of UI_FRAMEWORK_PACKAGE_KEYS) {
      expect(deps).not.toContain(forbidden);
    }
  });

  it('no file under packages/web/src (excluding test-support) references a persistent browser storage API', () => {
    for (const file of files) {
      const content = readFileSync(file, 'utf-8');
      for (const pattern of PERSISTENT_STORAGE_PATTERNS) {
        expect(
          pattern.test(content),
          `${relative(SRC_ROOT, file)} matched forbidden persistent-storage pattern ${pattern}`,
        ).toBe(false);
      }
    }
  });
});
