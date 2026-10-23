import { createHash } from 'node:crypto'

export type ScopeKind = 'turn' | 'work' | 'rev'

export interface RevisionDiffSpec {
  readonly mergeBase: boolean
  readonly detectRenames: boolean
  readonly ignoreWhitespace: 'none' | 'change' | 'all'
  readonly contextLines: number
  readonly pathFilters: readonly string[]
}

export const DEFAULT_REVISION_DIFF_SPEC: RevisionDiffSpec = {
  mergeBase: true,
  detectRenames: true,
  ignoreWhitespace: 'none',
  contextLines: 3,
  pathFilters: [],
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function canonical(value: unknown): string {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number'
  ) {
    return JSON.stringify(value)
  }
  if (typeof value === 'string') return JSON.stringify(value)
  if (Array.isArray(value))
    return `[${value.map((item) => canonical(item)).join(',')}]`
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([left], [right]) => left.localeCompare(right),
    )
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`
  }
  throw new Error(`Cannot canonicalize ${typeof value}`)
}

export function hashJson(value: unknown): string {
  return sha256(canonical(value))
}

export function normalizeDiffSpec(spec: RevisionDiffSpec): string {
  return hashJson({
    ...spec,
    pathFilters: [
      ...new Set(spec.pathFilters.map((path) => path.replaceAll('\\', '/'))),
    ].sort((left, right) => left.localeCompare(right)),
  })
}

export function turnScopeKey(
  sessionId: string,
  eventSeq: number,
  patchDigest: string,
): string {
  return `turn:${sessionId}:${String(eventSeq)}:${patchDigest}`
}

export function workScopeKey(
  repoIdentity: string,
  sessionId: string,
  baseOid: string,
): string {
  return `work:${repoIdentity}:${sessionId}:${baseOid}`
}

export function revisionScopeKey(
  repoIdentity: string,
  baseOid: string,
  headOid: string,
  diffSpec: RevisionDiffSpec,
): string {
  return `rev:${repoIdentity}:${baseOid}:${headOid}:${normalizeDiffSpec(diffSpec)}`
}

export function normalizeRemoteUrl(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length === 0) throw new Error('Remote URL is empty')
  const scp = /^(?:[^@/]+@)?([^:/]+):(.+)$/.exec(trimmed)
  if (scp !== null && !trimmed.includes('://')) {
    const host = scp[1]
    const path = scp[2]
    if (host === undefined || path === undefined)
      throw new Error('Invalid remote URL')
    return `ssh://${host}/${path.replace(/^\/+/, '').replace(/\.git$/, '')}`
  }
  try {
    const url = new URL(trimmed)
    url.username = ''
    url.password = ''
    url.hash = ''
    url.search = ''
    url.pathname = url.pathname.replace(/\/+$/, '').replace(/\.git$/, '')
    return url.toString().replace(/\/$/, '')
  } catch {
    return trimmed.replace(/\/+$/, '').replace(/\.git$/, '')
  }
}
