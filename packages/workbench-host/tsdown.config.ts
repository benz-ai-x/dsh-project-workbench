import { defineConfig } from 'tsdown'
import { typertPlugin } from '@deepseek-ai/dsh-typert-generator/tsdown'

/** Bundle the Host authority and browser-safe contract, then emit this package's Typert faces. */
export default defineConfig({
  entry: ['lib/types/index.js', 'lib/types/client.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
  plugins: [typertPlugin({ mode: 'package', faces: ['host'] })],
})
