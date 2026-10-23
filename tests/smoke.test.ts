import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('package manifest', () => {
  it('declares the Host and Web bundle', async () => {
    const manifest = JSON.parse(await readFile('package.json', 'utf8')) as {
      dsh: { bundle: { patch: string }; client: { platform: string } }
      license: string
    }
    expect(manifest.license).toBe('MIT')
    expect(manifest.dsh.bundle.patch).toBe('./cordis.patch.yml')
    expect(manifest.dsh.client.platform).toBe('web')
  })
})
