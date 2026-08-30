import { defineConfig } from 'vitest/config'
import ts from 'typescript'

const decoratorSyntax = /^\s*@[A-Za-z_$][\w$]*/m

/** Lower standard decorators exactly as the pinned Harness source runner does. */
function standardDecoratorPlugin() {
  return {
    name: 'workbench-standard-decorators',
    enforce: 'pre' as const,
    transform(code: string, id: string) {
      const file = id.split('?', 1)[0]
      if (file === undefined || !/\.[cm]?tsx?$/.test(file) || !decoratorSyntax.test(code)) return
      const result = ts.transpileModule(code, {
        fileName: file,
        compilerOptions: {
          target: ts.ScriptTarget.ES2024,
          module: ts.ModuleKind.ESNext,
          ...(file.endsWith('x') ? { jsx: ts.JsxEmit.ReactJSX } : {}),
          sourceMap: true,
        },
      })
      return {
        code: result.outputText.replace(/\n?\/\/# sourceMappingURL=.*$/u, '\n'),
        map: result.sourceMapText,
      }
    },
  }
}

export default defineConfig({
  plugins: [standardDecoratorPlugin()],
  test: {
    include: [
      'packages/*/tests/**/*.spec.{ts,tsx}',
      'profiles/*/tests/**/*.spec.ts',
      'tests/**/*.spec.{ts,tsx}',
    ],
    pool: 'forks',
    testTimeout: 30_000,
    hookTimeout: 30_000,
    restoreMocks: true,
  },
})
