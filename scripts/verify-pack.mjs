import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'

await import('./check-docs.mjs')

const output = execFileSync('pnpm', ['pack', '--dry-run', '--json'], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'inherit'],
})
const result = JSON.parse(output)
const packed = new Set(result.files.map((entry) => entry.path))
for (const path of [
  'package.json',
  'cordis.patch.yml',
  'README.md',
  'LICENSE',
  'skills/dsh-review-threads/SKILL.md',
  'lib/index.js',
  'lib/client.js',
]) {
  if (!packed.has(path)) throw new Error(`Package is missing ${path}`)
}

const pkg = JSON.parse(await readFile('package.json', 'utf8'))
if (pkg.dependencies?.['@deepseek-ai/dsh'] !== undefined) {
  throw new Error('The package must not depend on the host metapackage')
}
const client = await readFile('lib/client.js', 'utf8')
if (client.includes('require("@deepseek-ai/dsh-util-workspace-path")')) {
  throw new Error(
    'The browser bundle must include dsh-util-workspace-path instead of requiring an unmaterialized module',
  )
}

console.log(`Pack check passed for ${pkg.name}@${pkg.version}.`)
