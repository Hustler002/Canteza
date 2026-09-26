// Metro in an npm-workspaces monorepo.
//
// Without this, Metro only watches apps/mobile and only resolves its own
// node_modules, so `@canteza/shared` (TypeScript source, hoisted to the root)
// fails to resolve and edits to it do not trigger a reload.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// `disableHierarchicalLookup = true` used to sit here, to stop Metro finding two
// copies of React and breaking hooks in ways that look like application bugs.
//
// It was treating the symptom. The real cause was that `apps/admin` asked for
// `react: ^19.2.0`, which resolved to 19.3.0 and won the hoist, so npm placed a second
// nested copy of the 19.2.3 that Expo SDK 57 pins for `apps/mobile`. Both workspaces
// now name the same exact version, backed by an `overrides` block at the root, so one
// React is hoisted and there is nothing for Metro to disambiguate.
//
// The override mattered more once a native build entered the picture: `expo-doctor`
// flags duplicate native modules because a native build may contain only one copy of
// each, and it also flagged this line as a departure from `expo/metro-config`. Fixing
// the cause removed both complaints rather than silencing either.

module.exports = config;
