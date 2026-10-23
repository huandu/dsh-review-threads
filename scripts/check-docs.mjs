import { access, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const required = [
  'README.md',
  'README.zh.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'CODE_OF_CONDUCT.md',
  'docs/README.md',
  'docs/requirements/original.md',
  'docs/requirements/requirements.md',
  'docs/design.md',
  'docs/compatibility.md',
  'docs/decisions/0001-take-over-official-review-tab.md',
  'docs/decisions/0002-review-aggregate-and-approval.md',
  'docs/decisions/0003-scope-identity-and-storage.md',
]

for (const path of required) await access(path)

const markdown = []
for (const path of [
  'README.md',
  'README.zh.md',
  'CONTRIBUTING.md',
  'docs/README.md',
]) {
  markdown.push([path, await readFile(path, 'utf8')])
}

const broken = []
for (const [path, body] of markdown) {
  for (const match of body.matchAll(/\[[^\]]*\]\(([^)]+\.md(?:#[^)]*)?)\)/g)) {
    const target = match[1]
    if (target === undefined || /^[a-z]+:/i.test(target)) continue
    const local = target.split('#', 1)[0]
    if (local === undefined || local.length === 0) continue
    try {
      await access(resolve(dirname(path), local))
    } catch {
      broken.push(`${path}: ${target}`)
    }
  }
}

if (broken.length > 0) {
  throw new Error(`Broken documentation links:\n${broken.join('\n')}`)
}

const packageJson = JSON.parse(await readFile('package.json', 'utf8'))
if (packageJson.license !== 'MIT')
  throw new Error('package.json must declare the MIT license')
if (packageJson.dsh?.bundle?.patch !== './cordis.patch.yml') {
  throw new Error('package.json must declare dsh.bundle.patch')
}

console.log('Documentation checks passed.')
