import { defineConfig } from 'tsdown'

const packageId = 'dsh-review-threads'
const clientExternals = [
  'react',
  'react-dom',
  'react-dom/client',
  'react/jsx-runtime',
  '@deepseek-ai/cordis',
]

export default defineConfig([
  {
    entry: ['src/index.ts'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    dts: true,
    clean: true,
    fixedExtension: false,
    deps: {
      neverBundle: [/^node:/, /^@deepseek-ai\//],
    },
  },
  {
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib',
    format: ['cjs'],
    platform: 'browser',
    target: 'es2022',
    dts: true,
    clean: false,
    fixedExtension: false,
    sourcemap: true,
    deps: {
      neverBundle: (specifier) =>
        clientExternals.includes(specifier) ||
        specifier.startsWith('@deepseek-ai/dsh-'),
    },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(packageId)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
