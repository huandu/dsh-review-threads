import { describe, expect, it } from 'vitest'
import {
  DEFAULT_REVISION_DIFF_SPEC,
  normalizeDiffSpec,
  normalizeRemoteUrl,
  revisionScopeKey,
  turnScopeKey,
  workScopeKey,
  hashJson,
} from '../src/scope.js'

describe('scope identity', () => {
  it('normalizes credential-bearing and scp remotes without credentials', () => {
    expect(
      normalizeRemoteUrl('https://user:secret@example.com/acme/repo.git'),
    ).toBe('https://example.com/acme/repo')
    expect(normalizeRemoteUrl('git@example.com:acme/repo.git')).toBe(
      'ssh://example.com/acme/repo',
    )
  })

  it('canonicalizes diff options independent of filter order', () => {
    expect(
      normalizeDiffSpec({
        ...DEFAULT_REVISION_DIFF_SPEC,
        pathFilters: ['src/z.ts', 'src/a.ts', 'src/z.ts'],
      }),
    ).toBe(
      normalizeDiffSpec({
        ...DEFAULT_REVISION_DIFF_SPEC,
        pathFilters: ['src/a.ts', 'src/z.ts'],
      }),
    )
  })

  it('uses resolved components in keys', () => {
    expect(turnScopeKey('s', 4, 'p')).toBe('turn:s:4:p')
    expect(workScopeKey('repo', 's', 'abc')).toBe('work:repo:s:abc')
    expect(
      revisionScopeKey('repo', 'abc', 'def', DEFAULT_REVISION_DIFF_SPEC),
    ).toBe(`rev:repo:abc:def:${normalizeDiffSpec(DEFAULT_REVISION_DIFF_SPEC)}`)
  })

  it('hashes object keys deterministically', () => {
    expect(hashJson({ b: 2, a: 1 })).toBe(hashJson({ a: 1, b: 2 }))
  })
})
