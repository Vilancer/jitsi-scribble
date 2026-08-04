// Root barrel — re-exports codec, geometry, and transport ONLY. Never
// re-export ./schema here: doing so would pull effect/Schema into the bare
// package-root import, which throws at import time on any engine lacking
// TextEncoder/TextDecoder (bare React Native / Hermes without Expo's
// TextDecoder install). This is the protocol-side half of keeping the
// RN-entrypoint rule (PKG-04) true once Wave 2 replaces these placeholders
// with real content — consumers who need schema import
// '@vilancer/protocol/schema' explicitly.
export * from './codec/index.js';
export * from './geometry/index.js';
export * from './transport/index.js';

// Root-level marker proving the package's own module resolution end to end
// (consumed by apps/example/src/main.ts and by node -e smoke checks). Each
// subpath above has its own uniquely-named placeholder
// (__CODEC_PLACEHOLDER__, __GEOMETRY_PLACEHOLDER__, __TRANSPORT_PLACEHOLDER__)
// precisely so re-exporting all three via `export *` never collides — a
// shared name across subpaths triggers TS2308 (ambiguous re-export) at build
// time, discovered empirically while wiring this barrel.
export const __PLACEHOLDER__ = true;
