const fs = require('node:fs');
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// pnpm workspace: symlinked node_modules, sibling packages outside this app.
config.resolver.unstable_enableSymlinks = true;
config.watchFolders = [path.resolve(__dirname, '../..')];

// lib-jitsi-meet and its ESM deps resolve through "exports"/"module".
config.resolver.unstable_enablePackageExports = true;
config.resolver.resolverMainFields = ['react-native', 'browser', 'module', 'main'];

// pnpm keeps lib-jitsi-meet's own deps next to it in the store.
const ljmDir = fs.realpathSync(path.dirname(require.resolve('lib-jitsi-meet/package.json')));
const jsUtilsDist = path.join(ljmDir, '..', '@jitsi', 'js-utils', 'dist');
const punycodeCjs = require.resolve('punycode/punycode.js', { paths: [path.dirname(require.resolve('react-native-url-polyfill/package.json'))] });

config.resolver.resolveRequest = (context, moduleName, platform) => {
  // whatwg-url needs punycode's CommonJS build (.ucs2), not its ESM one.
  if (moduleName === 'punycode' || moduleName === 'punycode/') {
    return { type: 'sourceFile', filePath: punycodeCjs };
  }
  // @jitsi/js-utils exports extension-less subpaths that lib-jitsi-meet
  // imports without ".js"; resolve the real file.
  if (moduleName.startsWith('@jitsi/js-utils/')) {
    const base = path.join(jsUtilsDist, moduleName.slice('@jitsi/js-utils/'.length));
    const filePath = [base, `${base}.js`, path.join(base, 'index.js')].find(
      (c) => fs.existsSync(c) && fs.statSync(c).isFile(),
    );
    if (filePath) return { type: 'sourceFile', filePath };
  }
  // Workspace packages consumed from source use NodeNext ".js" specifiers
  // for ".ts" files; retry without the extension.
  if (moduleName.startsWith('.') && moduleName.endsWith('.js')) {
    try {
      return context.resolveRequest(context, moduleName.slice(0, -3), platform);
    } catch {
      // fall through
    }
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
