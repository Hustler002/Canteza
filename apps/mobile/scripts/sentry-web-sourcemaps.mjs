#!/usr/bin/env node
/**
 * After `expo export --platform web --source-maps`: hand the source maps to Sentry, then
 * take them out of the site.
 *
 *   node scripts/sentry-web-sourcemaps.mjs dist
 *
 * **Uploads only when `SENTRY_AUTH_TOKEN` is set** — a Vercel environment variable, never
 * a file in this repo. Without it the maps are simply deleted, so a clone, a preview or a
 * missing token still deploys; errors then arrive with minified stack traces.
 *
 * **A failed upload warns and does not fail the build.** An outage at Sentry or an expired
 * token should cost readable stack traces, not a deploy. Sentry's own Next.js plugin makes
 * the same call. The warning is loud in the build log.
 *
 * **The maps are always deleted**, uploaded or not, so the site never serves them: Sentry
 * matches a stack trace to its map by the debug id `getSentryExpoConfig` stamps into each
 * bundle, not by fetching anything from the site.
 *
 * The upload itself is Sentry's `expo-upload-sourcemaps` script. It looks for a plugin
 * named `@sentry/react-native/expo`, while app.json names `@sentry/react-native`, so the
 * org and project are read here and passed as environment variables instead.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = resolve(projectRoot, process.argv[2] ?? 'dist');

function findSourceMaps(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return findSourceMaps(path);
    return entry.name.endsWith('.map') ? [path] : [];
  });
}

function sentryTarget() {
  const appJson = JSON.parse(readFileSync(join(projectRoot, 'app.json'), 'utf8'));
  const plugin = appJson.expo.plugins.find(
    (entry) => Array.isArray(entry) && entry[0] === '@sentry/react-native',
  );
  return {
    SENTRY_ORG: process.env.SENTRY_ORG ?? plugin?.[1]?.organization,
    SENTRY_PROJECT: process.env.SENTRY_PROJECT ?? plugin?.[1]?.project,
    SENTRY_URL: process.env.SENTRY_URL ?? 'https://sentry.io/',
  };
}

function upload() {
  const target = sentryTarget();
  if (!target.SENTRY_ORG || !target.SENTRY_PROJECT) {
    return 'no Sentry org/project in app.json or the environment';
  }
  const script = createRequire(import.meta.url).resolve(
    '@sentry/react-native/scripts/expo-upload-sourcemaps.js',
  );
  const result = spawnSync(process.execPath, [script, distDir], {
    cwd: projectRoot,
    env: { ...process.env, ...target },
    stdio: 'inherit',
  });
  if (result.error) return result.error.message;
  return result.status === 0 ? null : `the upload exited with status ${result.status}`;
}

const maps = findSourceMaps(distDir);

if (maps.length === 0) {
  console.warn('[sentry] no source maps in the export; was it run with --source-maps?');
} else if (!process.env.SENTRY_AUTH_TOKEN) {
  console.log(`[sentry] SENTRY_AUTH_TOKEN not set: ${maps.length} source maps not uploaded.`);
} else {
  const failure = upload();
  if (failure) {
    console.warn(`[sentry] WARNING: source maps NOT uploaded (${failure}).`);
    console.warn('[sentry] The site still deploys; its errors will have minified stack traces.');
  } else {
    console.log(`[sentry] ${maps.length} source maps uploaded.`);
  }
}

for (const map of maps) rmSync(map);
if (maps.length > 0) console.log(`[sentry] removed ${maps.length} source maps from the site.`);
