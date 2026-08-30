import { defineConfig } from 'tsdown'
import { typertPlugin } from '@deepseek-ai/dsh-typert-generator/tsdown'

/** Bundle the Host authority and browser-safe contract, then emit this package's Typert faces. */
export default defineConfig({
  entry: [
    'lib/types/index.js',
    'lib/types/client.js',
    'lib/types/owner-auth-service.js',
    'lib/types/recovery.js',
    'lib/types/recover-cli.js',
  ],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  // Shared chunks are a deliberate packed surface: isolate them under one
  // cleaned directory so package.json can include the complete closure without
  // retaining stale content-addressed chunks between builds.
  outputOptions: { chunkFileNames: 'chunks/[name]-[hash].js' },
  fixedExtension: false,
  dts: false,
  clean: ['lib/chunks'],
  plugins: [typertPlugin({ mode: 'package', faces: ['host'] })],
})
