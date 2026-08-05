// The dual ES+IIFE build target this phase's own "Artifacts this phase
// produces" promise depends on (STACK.md's "The web/DOM renderer" +
// 04-RESEARCH.md's Code Examples): bootstrap.ts is the single entry both
// artifacts are built from. Phase 6's real custom-config.js/nginx mount
// consumes dist/jitsi-scribble.js (ES) and dist/jitsi-scribble.iife.js
// (IIFE) directly — not this package's own package.json exports map, which
// stays pointed at src/index.ts for TypeScript consumers.
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: 'src/bootstrap.ts',
      name: 'JitsiScribble',
      formats: ['es', 'iife'],
      fileName: (format) => (format === 'iife' ? 'jitsi-scribble.iife.js' : 'jitsi-scribble.js'),
    },
    outDir: 'dist',
  },
});
