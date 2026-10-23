import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import type { GitRunner, GitResult } from '../src/git.js'
import {
  revisionFileDiff,
  revisionSummary,
  workingFileDiff,
  workingSummary,
} from '../src/revision.js'
import { DEFAULT_REVISION_DIFF_SPEC } from '../src/scope.js'

const runFile = promisify(execFile)
const roots: string[] = []

const git = {
  async run(cwd: string, args: readonly string[]): Promise<GitResult> {
    try {
      const result = await runFile('git', args, { cwd, encoding: 'utf8' })
      return {
        stdout: result.stdout,
        exitCode: 0,
        truncated: false,
      }
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
  const root = await mkdtemp(join(tmpdir(), 'dsh-review-threads-'))
  roots.push(root)
  await git.require(root, ['init', '-q'])
  await git.require(root, ['config', 'user.name', 'Review Test'])
  await git.require(root, ['config', 'user.email', 'review@example.com'])
  await writeFile(join(root, 'a.ts'), 'one\ntwo\n')
  await git.require(root, ['add', '.'])
  await git.require(root, ['commit', '-qm', 'base'])
  return root
}

describe('Git-backed review ranges', () => {
  it('includes tracked modifications and untracked files in the working diff', async () => {
    const root = await repository()
    await writeFile(join(root, 'a.ts'), 'one\nchanged\n')
    await mkdir(join(root, 'src'))
    await writeFile(join(root, 'src/new.ts'), 'fresh\n')
    const signal = new AbortController().signal
    const head = await git.require(root, ['rev-parse', 'HEAD'])
    const summary = await workingSummary(
      git,
      root,
      head,
      { ...DEFAULT_REVISION_DIFF_SPEC, mergeBase: false },
      signal,
    )
    expect(summary.files.map((file) => file.path)).toEqual([
      'a.ts',
      'src/new.ts',
    ])
    const tracked = summary.files[0]
    const untracked = summary.files[1]
    if (tracked === undefined || untracked === undefined) {
      throw new Error('Expected both changed files')
    }
    await expect(
      workingFileDiff(
        git,
        root,
        head,
        { ...DEFAULT_REVISION_DIFF_SPEC, mergeBase: false },
        tracked,
        signal,
      ),
    ).resolves.toMatchObject({ kind: 'text', before: true, after: true })
    await expect(
      workingFileDiff(
        git,
        root,
        head,
        { ...DEFAULT_REVISION_DIFF_SPEC, mergeBase: false },
        untracked,
        signal,
      ),
    ).resolves.toMatchObject({ kind: 'text', before: false, after: true })
  })

  it('reads a resolved revision range and a single file comparison', async () => {
    const root = await repository()
    const base = await git.require(root, ['rev-parse', 'HEAD'])
    await writeFile(join(root, 'a.ts'), 'one\ntwo\nthree\n')
    await git.require(root, ['add', 'a.ts'])
    await git.require(root, ['commit', '-qm', 'change'])
    const head = await git.require(root, ['rev-parse', 'HEAD'])
    const signal = new AbortController().signal
    const spec = DEFAULT_REVISION_DIFF_SPEC
    const summary = await revisionSummary(git, root, base, head, spec, signal)
    expect(summary).toMatchObject({ total: 1, added: 1, deleted: 0 })
    const file = summary.files[0]
    if (file === undefined) throw new Error('Expected one changed file')
    const diff = await revisionFileDiff(
      git,
      root,
      base,
      head,
      spec,
      file,
      signal,
    )
    expect(diff.kind).toBe('text')
    if (diff.kind !== 'text') throw new Error('Expected a text diff')
    expect(diff.hunks.flatMap((hunk) => hunk.lines)).toContain('+three')
  })
})
