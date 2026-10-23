import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import type { GitResult, GitRunner } from '../src/git.js'
import { createMemoryService, sessionId } from './helpers/memory-domain.js'

const runFile = promisify(execFile)
const roots: string[] = []

const git = {
  async run(cwd: string, args: readonly string[]): Promise<GitResult> {
    try {
      const result = await runFile('git', args, { cwd, encoding: 'utf8' })
      return { stdout: result.stdout, exitCode: 0, truncated: false }
    } catch (error) {
      const failure = error as { code?: unknown; stdout?: string }
      return {
        stdout: failure.stdout ?? '',
        exitCode: typeof failure.code === 'number' ? failure.code : 1,
        truncated: false,
      }
    }
  },
  async require(cwd: string, args: readonly string[]): Promise<string> {
    const result = await git.run(cwd, args)
    if (result.exitCode !== 0) throw new Error('git command failed')
    return result.stdout.trim()
  },
} as GitRunner

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  )
})

async function repository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-review-working-'))
  roots.push(root)
  await git.require(root, ['init', '-q'])
  await git.require(root, ['config', 'user.name', 'Review Test'])
  await git.require(root, ['config', 'user.email', 'review@example.com'])
  await writeFile(join(root, 'a.ts'), 'one\n')
  await git.require(root, ['add', '.'])
  await git.require(root, ['commit', '-qm', 'base'])
  return root
}

describe('working scope snapshots', () => {
  it('keeps the Review while a changed line becomes outdated', async () => {
    const root = await repository()
    await writeFile(join(root, 'a.ts'), 'one\ntwo\n')
    const { service } = createMemoryService({ git, cwd: root })
    const session = sessionId()
    const signal = new AbortController().signal
    const scope = await service.prepareWorking(session, signal)
    await service.addUserComment({
      reviewId: scope.reviewId,
      sessionId: session,
      turn: 0,
      anchor: {
        path: 'a.ts',
        side: 'new',
        line: 2,
        lineText: 'two',
        beforeText: 'one',
        afterText: null,
        hunkHeader: '@@ -1,1 +1,2 @@',
        hunkText: ' one\n+two',
        snapshotRevision: scope.scopeKey,
      },
      body: 'Please keep this line.',
    })

    await writeFile(join(root, 'a.ts'), 'one\nthree\n')
    await service.refreshWorking(scope.scopeKey, signal)

    const review = service.getReview(scope.reviewId)
    expect(review?.activeScopeKey).toBe(scope.scopeKey)
    expect(service.userThreads(scope.reviewId)[0]).toMatchObject({
      status: 'outdated',
      anchor: { path: 'a.ts', line: 2 },
      comments: [{ body: 'Please keep this line.' }],
    })
  })
})
