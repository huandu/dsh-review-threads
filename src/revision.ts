import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { GitRunner } from './git.js'
import type {
  ReviewDiffHunk,
  ReviewFileDiff,
  ReviewFileSummary,
  ReviewSummary,
} from './protocol.js'
import type { RevisionDiffSpec } from './scope.js'

export const EMPTY_TREE_OID = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
const MAX_FILE_BYTES = 2 * 1024 * 1024

function range(base: string, head: string, mergeBase: boolean): string {
  return mergeBase ? `${base}...${head}` : `${base}..${head}`
}

function diffOptions(spec: RevisionDiffSpec): readonly string[] {
  const options = ['--no-ext-diff', '--no-color']
  if (spec.detectRenames) options.push('--find-renames')
  if (spec.ignoreWhitespace === 'change') options.push('--ignore-space-change')
  if (spec.ignoreWhitespace === 'all') options.push('--ignore-all-space')
  return options
}

function pathspec(spec: RevisionDiffSpec): readonly string[] {
  return ['--', ...spec.pathFilters]
}

function numstatArgs(
  base: string,
  head: string | null,
  spec: RevisionDiffSpec,
): readonly string[] {
  return [
    'diff',
    ...diffOptions(spec),
    '--numstat',
    '-z',
    ...(head === null ? [base] : [range(base, head, spec.mergeBase)]),
    ...pathspec(spec),
  ]
}

export interface NumstatEntry {
  readonly oldPath?: string
  readonly path: string
  readonly added: number
  readonly deleted: number
  readonly binary: boolean
}

export function parseNumstat(output: string): readonly NumstatEntry[] {
  const fields = output.split('\0')
  const entries: NumstatEntry[] = []
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index]
    if (field === undefined || field.length === 0) continue
    const [addedText, deletedText, firstPath] = field.split('\t')
    if (
      addedText === undefined ||
      deletedText === undefined ||
      firstPath === undefined
    ) {
      continue
    }
    let oldPath: string | undefined
    let path = firstPath
    if (firstPath.length === 0) {
      oldPath = fields[index + 1]
      path = fields[index + 2] ?? ''
      index += 2
    }
    if (path.length === 0) continue
    const binary = addedText === '-' || deletedText === '-'
    const added = binary ? 0 : Number(addedText)
    const deleted = binary ? 0 : Number(deletedText)
    if (!Number.isSafeInteger(added) || !Number.isSafeInteger(deleted)) continue
    entries.push({
      ...(oldPath === undefined || oldPath.length === 0 ? {} : { oldPath }),
      path,
      added,
      deleted,
      binary,
    })
  }
  return entries
}

function summaryOf(
  entries: readonly NumstatEntry[],
  extra: readonly ReviewFileSummary[] = [],
): ReviewSummary {
  const files: ReviewFileSummary[] = entries.map((entry) => ({
    path: entry.path,
    display:
      entry.oldPath === undefined
        ? entry.path
        : `${entry.oldPath} → ${entry.path}`,
    ...(entry.oldPath === undefined ? {} : { oldPath: entry.oldPath }),
    added: entry.added,
    deleted: entry.deleted,
    ...(entry.binary ? { binary: true as const } : {}),
  }))
  files.push(...extra)
  files.sort((left, right) => left.display.localeCompare(right.display))
  return {
    turn: 0,
    files,
    total: files.length,
    added: files.reduce((total, file) => total + file.added, 0),
    deleted: files.reduce((total, file) => total + file.deleted, 0),
  }
}

async function numstat(
  git: GitRunner,
  cwd: string,
  args: readonly string[],
): Promise<readonly NumstatEntry[]> {
  const result = await git.run(cwd, args)
  if (result.exitCode !== 0) throw new Error('Could not read revision diff')
  return parseNumstat(result.stdout)
}

export async function revisionSummary(
  git: GitRunner,
  cwd: string,
  base: string,
  head: string,
  spec: RevisionDiffSpec,
  _signal: AbortSignal,
): Promise<ReviewSummary> {
  return summaryOf(await numstat(git, cwd, numstatArgs(base, head, spec)))
}

async function untrackedPaths(
  git: GitRunner,
  cwd: string,
  spec: RevisionDiffSpec,
): Promise<readonly string[]> {
  const result = await git.run(cwd, [
    'ls-files',
    '--others',
    '--exclude-standard',
    '-z',
    ...pathspec(spec),
  ])
  if (result.exitCode !== 0) throw new Error('Could not list untracked files')
  return result.stdout.split('\0').filter((path) => path.length > 0)
}

async function untrackedSummary(
  cwd: string,
  paths: readonly string[],
): Promise<readonly ReviewFileSummary[]> {
  const files: ReviewFileSummary[] = []
  for (const path of paths) {
    const bytes = await readFile(resolve(cwd, path))
    const binary = bytes.includes(0)
    const lineCount =
      bytes.length === 0
        ? 0
        : bytes.toString('utf8').split('\n').length -
          (bytes.at(-1) === 10 ? 1 : 0)
    files.push({
      path,
      display: path,
      added: binary || bytes.length > MAX_FILE_BYTES ? 0 : lineCount,
      deleted: 0,
      ...(binary ? { binary: true as const } : {}),
      ...(bytes.length > MAX_FILE_BYTES ? { oversized: true as const } : {}),
    })
  }
  return files
}

export async function workingSummary(
  git: GitRunner,
  cwd: string,
  base: string,
  spec: RevisionDiffSpec,
  _signal: AbortSignal,
): Promise<ReviewSummary> {
  const [tracked, untracked] = await Promise.all([
    numstat(git, cwd, numstatArgs(base, null, spec)),
    untrackedPaths(git, cwd, spec),
  ])
  return summaryOf(tracked, await untrackedSummary(cwd, untracked))
}

export function parseUnifiedHunks(
  patch: string,
  path: string,
): readonly ReviewDiffHunk[] {
  const hunks: ReviewDiffHunk[] = []
  let current: ReviewDiffHunk | undefined
  for (const line of patch.split('\n')) {
    const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line)
    if (match !== null) {
      const oldStart = Number(match[1])
      const oldLines = Number(match[2] ?? '1')
      const newStart = Number(match[3])
      const newLines = Number(match[4] ?? '1')
      if (
        Number.isSafeInteger(oldStart) &&
        Number.isSafeInteger(oldLines) &&
        Number.isSafeInteger(newStart) &&
        Number.isSafeInteger(newLines)
      ) {
        current = { oldStart, oldLines, newStart, newLines, lines: [] }
        hunks.push(current)
      }
      continue
    }
    if (
      current !== undefined &&
      (line.startsWith('+') ||
        line.startsWith('-') ||
        line.startsWith(' ') ||
        line.startsWith('\\'))
    ) {
      if (!line.startsWith('\\')) current.lines.push(line)
    } else if (line.startsWith('diff --git ') || line.startsWith('--- ')) {
      current = undefined
    }
  }
  return path.length === 0 ? [] : hunks
}

function textDiff(
  path: string,
  display: string,
  patch: string,
  before: boolean,
  after: boolean,
): ReviewFileDiff {
  return {
    kind: 'text',
    path,
    display,
    before,
    after,
    hunks: [...parseUnifiedHunks(patch, path)],
    coarse: false,
  }
}

function binaryPatch(patch: string): boolean {
  return /^Binary files .* differ$/m.test(patch)
}

function headers(patch: string): {
  readonly before: boolean
  readonly after: boolean
} {
  return {
    before: !/^--- \/dev\/null$/m.test(patch),
    after: !/^\+\+\+ \/dev\/null$/m.test(patch),
  }
}

export async function revisionFileDiff(
  git: GitRunner,
  cwd: string,
  base: string,
  head: string,
  spec: RevisionDiffSpec,
  file: ReviewFileSummary,
  _signal: AbortSignal,
): Promise<ReviewFileDiff> {
  const paths = [
    ...(file.oldPath === undefined ? [] : [file.oldPath]),
    file.path,
  ]
  const result = await git.run(cwd, [
    'diff',
    ...diffOptions(spec),
    `--unified=${String(spec.contextLines)}`,
    range(base, head, spec.mergeBase),
    '--',
    ...paths,
  ])
  if (result.exitCode !== 0)
    throw new Error('Could not read revision file comparison')
  if (result.truncated) {
    return { kind: 'oversized', path: file.path, display: file.display }
  }
  if (binaryPatch(result.stdout)) {
    return { kind: 'binary', path: file.path, display: file.display }
  }
  const side = headers(result.stdout)
  return textDiff(
    file.path,
    file.display,
    result.stdout,
    side.before,
    side.after,
  )
}

async function isUntracked(
  git: GitRunner,
  cwd: string,
  path: string,
): Promise<boolean> {
  const result = await git.run(cwd, [
    'ls-files',
    '--others',
    '--exclude-standard',
    '-z',
    '--',
    path,
  ])
  if (result.exitCode !== 0) throw new Error('Could not inspect untracked file')
  return result.stdout.split('\0').includes(path)
}

async function untrackedDiff(
  cwd: string,
  file: ReviewFileSummary,
): Promise<ReviewFileDiff> {
  if (file.oversized === true) {
    return { kind: 'oversized', path: file.path, display: file.display }
  }
  const bytes = await readFile(resolve(cwd, file.path))
  if (bytes.includes(0)) {
    return { kind: 'binary', path: file.path, display: file.display }
  }
  if (bytes.length > MAX_FILE_BYTES) {
    return { kind: 'oversized', path: file.path, display: file.display }
  }
  const lines = bytes.toString('utf8').split('\n')
  if (bytes.length > 0 && bytes.at(-1) === 10) lines.pop()
  return {
    kind: 'text',
    path: file.path,
    display: file.display,
    before: false,
    after: true,
    hunks:
      lines.length === 0
        ? []
        : [
            {
              oldStart: 1,
              oldLines: 0,
              newStart: 1,
              newLines: lines.length,
              lines: lines.map((line) => `+${line}`),
            },
          ],
    coarse: false,
  }
}

export async function workingFileDiff(
  git: GitRunner,
  cwd: string,
  base: string,
  spec: RevisionDiffSpec,
  file: ReviewFileSummary,
  _signal: AbortSignal,
): Promise<ReviewFileDiff> {
  if (await isUntracked(git, cwd, file.path)) {
    return untrackedDiff(cwd, file)
  }
  const result = await git.run(cwd, [
    'diff',
    ...diffOptions(spec),
    `--unified=${String(spec.contextLines)}`,
    base,
    '--',
    file.path,
  ])
  if (result.exitCode !== 0)
    throw new Error('Could not read working file comparison')
  if (result.truncated) {
    return { kind: 'oversized', path: file.path, display: file.display }
  }
  if (binaryPatch(result.stdout)) {
    return { kind: 'binary', path: file.path, display: file.display }
  }
  const side = headers(result.stdout)
  return textDiff(
    file.path,
    file.display,
    result.stdout,
    side.before,
    side.after,
  )
}
