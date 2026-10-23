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
const anchor = {
  path: 'a.ts',
  side: 'new' as const,
  line: 2,
  lineText: 'two',
  beforeText: 'one',
  afterText: null,
  hunkHeader: '@@ -1,1 +1,2 @@',
  hunkText: ' one\n+two',
}

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
  const root = await mkdtemp(join(tmpdir(), 'dsh-review-binding-'))
  roots.push(root)
  await git.require(root, ['init', '-q'])
  await git.require(root, ['config', 'user.name', 'Review Test'])
  await git.require(root, ['config', 'user.email', 'review@example.com'])
  await writeFile(join(root, 'a.ts'), 'one\n')
  await git.require(root, ['add', '.'])
  await git.require(root, ['commit', '-qm', 'base'])
  return root
}

async function prepareBoth() {
  const root = await repository()
  const base = await git.require(root, ['rev-parse', 'HEAD'])
  await writeFile(join(root, 'a.ts'), 'one\ntwo\n')
  const signal = new AbortController().signal
  const memory = createMemoryService({ git, cwd: root })
  const session = sessionId()
  const work = await memory.service.prepareWorking(session, signal)
  await git.require(root, ['add', 'a.ts'])
  await git.require(root, ['commit', '-qm', 'change'])
  const head = await git.require(root, ['rev-parse', 'HEAD'])
  const revision = await memory.service.prepareRevision(
    session,
    `${base}..${head}`,
    [],
    signal,
  )
  return { ...memory, session, work, revision }
}

describe('working-to-revision binding', () => {
  it('preserves thread identity and makes the old work scope an alias', async () => {
    const { service, session, work, revision } = await prepareBoth()
    const added = await service.addUserComment({
      reviewId: work.reviewId,
      sessionId: session,
      turn: 0,
      anchor: { ...anchor, snapshotRevision: work.scopeKey },
      body: 'Keep this.',
    })
    await service.updateDraft(added.draft.draftId, {
      verdict: 'request_changes',
    })
    const submission = await service.submitDraft(added.draft.draftId)
    expect(service.bindingSuggestion(revision.scopeKey, session)).toMatchObject(
      {
        workScopeKey: work.scopeKey,
        patchMatches: true,
        targetHasHistory: false,
      },
    )

    const binding = await service.bindWorkingToRevision({
      workScopeKey: work.scopeKey,
      revisionScopeKey: revision.scopeKey,
      sessionId: session,
    })
    expect(binding.state).toBe('committed')
    expect(binding.targetReviewId).toBe(work.reviewId)
    expect(service.get(work.scopeKey)?.reviewId).toBe(work.reviewId)
    expect(service.get(revision.scopeKey)?.reviewId).toBe(work.reviewId)
    expect(service.userThreads(work.reviewId)).toEqual([
      expect.objectContaining({ threadId: added.thread.threadId }),
    ])
    expect(service.getSubmission(submission.submissionId)?.reviewId).toBe(
      work.reviewId,
    )
    expect(service.getReview(work.reviewId)?.currentDecision).toBe(
      'request_changes',
    )
    expect(
      await service.bindWorkingToRevision({
        workScopeKey: work.scopeKey,
        revisionScopeKey: revision.scopeKey,
        sessionId: session,
      }),
    ).toEqual(binding)
    expect(
      service.bindingSuggestion(revision.scopeKey, session),
    ).toBeUndefined()
  })

  it('merges duplicate line threads and keeps both comments in one thread', async () => {
    const { service, session, work, revision } = await prepareBoth()
    const target = await service.addUserComment({
      reviewId: revision.reviewId,
      sessionId: session,
      turn: 0,
      anchor: { ...anchor, snapshotRevision: revision.scopeKey },
      body: 'Revision-side comment.',
    })
    await service.addUserComment({
      reviewId: work.reviewId,
      sessionId: session,
      turn: 0,
      anchor: { ...anchor, snapshotRevision: work.scopeKey },
      body: 'Working-side comment.',
    })
    await service.bindWorkingToRevision({
      workScopeKey: work.scopeKey,
      revisionScopeKey: revision.scopeKey,
      sessionId: session,
    })
    const threads = service.userThreads(revision.reviewId)
    expect(threads).toHaveLength(1)
    expect(threads[0]?.threadId).toBe(target.thread.threadId)
    expect(threads[0]?.comments.map((comment) => comment.body)).toEqual([
      'Revision-side comment.',
      'Working-side comment.',
    ])
    expect(service.draftFor(revision.reviewId, session)?.threadIds).toEqual([
      target.thread.threadId,
    ])
  })

  it('rolls back a partial merge and succeeds on retry', async () => {
    const memory = await prepareBoth()
    const { service, session, work, revision } = memory
    await service.addUserComment({
      reviewId: work.reviewId,
      sessionId: session,
      turn: 0,
      anchor: { ...anchor, snapshotRevision: work.scopeKey },
      body: 'Must survive rollback.',
    })
    memory.failNextPut('review_bindings', 2)
    await expect(
      service.bindWorkingToRevision({
        workScopeKey: work.scopeKey,
        revisionScopeKey: revision.scopeKey,
        sessionId: session,
      }),
    ).rejects.toThrow(/Injected failure/)
    expect(service.get(work.scopeKey)?.reviewId).toBe(work.reviewId)
    expect(service.userThreads(work.reviewId)).toHaveLength(1)
    expect(service.userThreads(revision.reviewId)).toHaveLength(0)

    await expect(
      service.bindWorkingToRevision({
        workScopeKey: work.scopeKey,
        revisionScopeKey: revision.scopeKey,
        sessionId: session,
      }),
    ).resolves.toMatchObject({ state: 'committed' })
    expect(service.get(revision.scopeKey)?.reviewId).toBe(work.reviewId)
    expect(service.userThreads(work.reviewId)).toHaveLength(1)
  })
})
