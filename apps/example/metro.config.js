const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// pnpm workspace: node_modules is symlink-heavy, and sibling workspace
// packages (@vilancer/react-native, @vilancer/protocol) live outside this
// app's own directory tree.
config.resolver.unstable_enableSymlinks = true;
config.watchFolders = [require('node:path').resolve(__dirname, '../..')];

// @vilancer/* packages are consumed straight from src/ (their package.json
// "exports" point at .ts files, not a built dist/) and use TS NodeNext-style
// relative imports — "./ScribbleOverlay.js" resolving to ScribbleOverlay.ts
// at the source level. Metro's resolver treats an explicit ".js" specifier
// literally and never tries the sibling ".ts"/".tsx" file, so retry those
// imports without the extension and let Metro's own sourceExts fallback
// (already includes ts/tsx) find the real file.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.startsWith('.') && moduleName.endsWith('.js')) {
    try {
      return context.resolveRequest(context, moduleName.slice(0, -3), platform);
    } catch {
      // fall through to the default (literal .js) resolution below
    }
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
