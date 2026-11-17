// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');
const fs = require('fs');
const path = require('path');

const config = getDefaultConfig(__dirname);

// When the example has its own copy of react / react-native, exclude the parent
// folder's copy so two incompatible instances are never bundled. With pnpm's
// hoisted node-linker the only copy lives in ../node_modules, so nothing is
// blocked in that layout. An empty blockList array would exclude every file, so
// only extend Expo's default (a single RegExp) when there is something to add.
const parentCopies = ['react', 'react-native']
  .filter((name) => fs.existsSync(path.resolve(__dirname, 'node_modules', name)))
  .map((name) => new RegExp(`${path.resolve(__dirname, '..', 'node_modules', name)}/`));
if (parentCopies.length > 0) {
  config.resolver.blockList = [...[].concat(config.resolver.blockList ?? []), ...parentCopies];
}

config.resolver.nodeModulesPaths = [
  path.resolve(__dirname, './node_modules'),
  path.resolve(__dirname, '../node_modules'),
];

config.resolver.extraNodeModules = {
  'react-native-asleep': '..',
};

config.watchFolders = [path.resolve(__dirname, '..')];

config.transformer.getTransformOptions = async () => ({
  transform: {
    experimentalImportSupport: false,
    inlineRequires: true,
  },
});

module.exports = config;
