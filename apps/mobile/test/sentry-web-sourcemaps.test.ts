import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * The web build's last step: upload source maps to Sentry when a token is set, and never
 * leave them on the site. Run for real against a throwaway export. The upload goes
 * through Sentry's own script to a stand-in `sentry-cli` (via `SENTRY_CLI_EXECUTABLE`,
 * which that script honours), so the path is exercised without a token or a network.
 */

const script = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'scripts',
  'sentry-web-sourcemaps.mjs',
);

let root: string;
let dist: string;
let bundle: string;
let map: string;
let record: string;

function fakeCli(exitCode: number): string {
  const path = join(root, 'fake-sentry-cli.js');
  writeFileSync(
    path,
    [
      '#!/usr/bin/env node',
      "const { writeFileSync } = require('node:fs');",
      `writeFileSync(${JSON.stringify(record)}, JSON.stringify({`,
      '  args: process.argv.slice(2),',
      '  org: process.env.SENTRY_ORG,',
      '  project: process.env.SENTRY_PROJECT,',
      '}));',
      `process.exit(${exitCode});`,
    ].join('\n'),
  );
  chmodSync(path, 0o755);
  return path;
}

function build(env: Record<string, string>) {
  const clean = { ...process.env };
  delete clean.SENTRY_AUTH_TOKEN;
  delete clean.SENTRY_ORG;
  delete clean.SENTRY_PROJECT;
  const result = spawnSync(process.execPath, [script, dist], {
    env: { ...clean, ...env },
    encoding: 'utf8',
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'canteza-sentry-'));
  dist = join(root, 'dist');
  const js = join(dist, '_expo', 'static', 'js', 'web');
  mkdirSync(js, { recursive: true });
  bundle = join(js, 'entry-abc.js');
  map = `${bundle}.map`;
  record = join(root, 'cli-call.json');
  writeFileSync(bundle, 'console.log(1);\n//# debugId=abc\n');
  writeFileSync(map, JSON.stringify({ version: 3, sources: [], mappings: '', debugId: 'abc' }));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('sentry-web-sourcemaps', () => {
  it('without a token: uploads nothing, removes the maps, keeps the bundle, succeeds', () => {
    const { status, output } = build({ SENTRY_CLI_EXECUTABLE: fakeCli(0) });

    expect(status).toBe(0);
    expect(output).toMatch(/SENTRY_AUTH_TOKEN not set/);
    expect(existsSync(record)).toBe(false);
    expect(existsSync(map)).toBe(false);
    expect(existsSync(bundle)).toBe(true);
  });

  it("with a token: uploads through Sentry's script to the app.json org and project", () => {
    const { status, output } = build({
      SENTRY_AUTH_TOKEN: 'test-fixture-not-a-token',
      SENTRY_CLI_EXECUTABLE: fakeCli(0),
    });

    expect(status).toBe(0);
    expect(output).toMatch(/1 source maps uploaded/);
    const call = JSON.parse(readFileSync(record, 'utf8'));
    expect(call.args.slice(0, 2)).toEqual(['sourcemaps', 'upload']);
    expect(call.args).toContain(bundle);
    expect(call.args).toContain(map);
    expect(call.org).toBe('moneytrail');
    expect(call.project).toBe('canteza-mobile');
    expect(existsSync(map)).toBe(false);
  });

  it('a failed upload warns but still deploys, and still removes the maps', () => {
    const { status, output } = build({
      SENTRY_AUTH_TOKEN: 'test-fixture-not-a-token',
      SENTRY_CLI_EXECUTABLE: fakeCli(1),
    });

    expect(status).toBe(0);
    expect(output).toMatch(/source maps NOT uploaded/);
    expect(existsSync(map)).toBe(false);
  });

  it('never prints the token', () => {
    const { output } = build({
      SENTRY_AUTH_TOKEN: 'test-fixture-not-a-token',
      SENTRY_CLI_EXECUTABLE: fakeCli(1),
    });

    expect(output).not.toContain('test-fixture-not-a-token');
  });
});
