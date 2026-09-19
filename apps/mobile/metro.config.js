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
// Hoisting can leave two copies of React on the graph, which breaks hooks in ways
// that look like application bugs.
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
