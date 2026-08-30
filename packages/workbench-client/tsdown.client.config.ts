/**
 * Standalone Client build for an external DSH project.
 *
 * This deliberately owns the lazy-CJS wrapper and CSS Module transform rather
 * than importing Harness's repository-private clientBundle preset.
 */

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { UserConfig } from 'tsdown'
import { transform } from 'lightningcss'

const PACKAGE_ID = '@benz-ai-x/dsh-project-workbench-client'
const TYPES_MARKER = `${sep}lib${sep}types${sep}`
const CSS_PREFIX = '\0workbench-css:'
const CSS_SUFFIX = '.mjs'
const PACKAGE_ROOT = dirname(fileURLToPath(import.meta.url))
const STYLE_LIFECYCLE_MODULE = resolve(PACKAGE_ROOT, 'lib/types/client/style-lifecycle.js')

/** Runtime identities supplied by the DSH Client module table. */
const CLIENT_EXTERNALS = new Set([
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-primitives',
  'react',
  'react/jsx-runtime',
])

function sourceAssetPath(specifier: string, importer: string): string {
  const emitted = resolve(dirname(importer), specifier)
  if (existsSync(emitted)) return emitted
  const boundary = emitted.indexOf(TYPES_MARKER)
  if (boundary < 0) return emitted
  return resolve(emitted.slice(0, boundary), 'src', emitted.slice(boundary + TYPES_MARKER.length))
}

function cssInjectionModule(
  file: string,
  css: string,
  classes: Readonly<Record<string, string>>,
): string {
  const tagId = `${PACKAGE_ID}/${basename(file)}`
  return [
    `import { registerWorkbenchStyle } from ${JSON.stringify(STYLE_LIFECYCLE_MODULE)};`,
    `const css = ${JSON.stringify(css)};`,
    `const tagId = ${JSON.stringify(tagId)};`,
    'registerWorkbenchStyle(tagId, css);',
    `export default ${JSON.stringify(classes)};`,
  ].join('\n')
}

const nodeConfig: UserConfig = {
  name: PACKAGE_ID,
  entry: { index: 'lib/types/index.js' },
  outDir: 'lib',
  format: 'esm',
  platform: 'node',
  target: 'es2024',
  dts: false,
  clean: false,
  sourcemap: false,
  outputOptions: { entryFileNames: 'index.js' },
}

const clientConfig: UserConfig = {
  name: `${PACKAGE_ID}/client`,
  entry: { client: 'lib/types/client/index.js' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2024',
  dts: false,
  clean: false,
  sourcemap: false,
  deps: {
    neverBundle: specifier => CLIENT_EXTERNALS.has(specifier),
    alwaysBundle: specifier => !CLIENT_EXTERNALS.has(specifier),
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
  },
  plugins: [{
    name: 'workbench-css-modules-inline',
    resolveId(source: string, importer: string | undefined) {
      if (!source.endsWith('.module.css')) return null
      const file = importer === undefined ? source : sourceAssetPath(source, importer)
      return CSS_PREFIX + file + CSS_SUFFIX
    },
    async load(virtualId: string) {
      if (!virtualId.startsWith(CSS_PREFIX)) return null
      const file = virtualId.slice(CSS_PREFIX.length, -CSS_SUFFIX.length)
      this.addWatchFile(file)
      const source = await readFile(file)
      const output = transform({
        filename: file,
        code: source,
        cssModules: { pattern: '[hash]_[local]' },
        minify: true,
      })
      const classes: Record<string, string> = {}
      for (const [local, value] of Object.entries(output.exports ?? {}).sort(([left], [right]) => left.localeCompare(right))) {
        classes[local] = value.name
      }
      return cssInjectionModule(file, output.code.toString(), classes)
    },
  }],
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PACKAGE_ID)}, factory: (require) => {`,
    intro: 'var module = { exports: {} }; var exports = module.exports;',
    footer: 'return module.exports; } });',
  },
}

export default [nodeConfig, clientConfig]
