import type { Context } from '@deepseek-ai/cordis'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { reviewThreadsDomain, type ScopeRecord } from './domain.js'
import { resolveRepositoryIdentity, type GitRunner } from './git.js'
import {
  DEFAULT_REVISION_DIFF_SPEC,
  normalizeDiffSpec,
  revisionScopeKey,
  turnScopeKey,
  workScopeKey,
  type RevisionDiffSpec,
} from './scope.js'

type ReviewThreadsDomain = Domain<typeof reviewThreadsDomain>

export interface TurnScopeInput {
  readonly sessionId: SessionId
  readonly eventSeq: number
  readonly turn: number
  readonly patchDigest: string
}

export interface WorkingScopeInput {
  readonly sessionId: SessionId
  readonly cwd: string
}

export interface RevisionScopeInput {
  readonly repoIdentity: string
  readonly baseOid: string
  readonly headOid: string
  readonly diffSpec?: RevisionDiffSpec
}

export class ReviewThreadService {
  constructor(
    private readonly ctx: Context,
    private readonly domain: ReviewThreadsDomain,
    private readonly git: GitRunner,
  ) {}

  private scopes() {
    return this.domain.table('scopes')
  }

  private async putScope(record: ScopeRecord): Promise<ScopeRecord> {
    await this.scopes().put(record.scopeKey, record)
    return record
  }

  get(scopeKey: string): ScopeRecord | undefined {
    return this.scopes().get(scopeKey)
  }

  async resolveTurn(input: TurnScopeInput): Promise<ScopeRecord> {
    const key = turnScopeKey(input.sessionId, input.eventSeq, input.patchDigest)
    const existing = this.scopes().get(key)
    if (existing !== undefined) return existing
    const now = new Date().toISOString()
    return this.putScope({
      scopeKey: key,
      kind: 'turn',
      repoIdentity: null,
      sessionId: input.sessionId,
      eventSeq: input.eventSeq,
      turn: input.turn,
      baseOid: null,
      headOid: null,
      patchDigest: input.patchDigest,
      diffSpecDigest: null,
      createdAt: now,
      updatedAt: now,
    })
  }

  async resolveWorking(input: WorkingScopeInput): Promise<ScopeRecord> {
    const repo = await resolveRepositoryIdentity(this.git, input.cwd)
    if (repo === undefined)
      throw new Error('The working directory is not a Git repository')
    const baseOid = repo.headOid ?? 'EMPTY_TREE'
    const key = workScopeKey(repo.identity, input.sessionId, baseOid)
    const existing = this.scopes().get(key)
    if (existing !== undefined) return existing
    const now = new Date().toISOString()
    return this.putScope({
      scopeKey: key,
      kind: 'work',
      repoIdentity: repo.identity,
      sessionId: input.sessionId,
      eventSeq: null,
      turn: null,
      baseOid,
      headOid: null,
      patchDigest: null,
      diffSpecDigest: null,
      createdAt: now,
      updatedAt: now,
    })
  }

  async resolveRevision(input: RevisionScopeInput): Promise<ScopeRecord> {
    const diffSpec = input.diffSpec ?? DEFAULT_REVISION_DIFF_SPEC
    const key = revisionScopeKey(
      input.repoIdentity,
      input.baseOid,
      input.headOid,
      diffSpec,
    )
    const existing = this.scopes().get(key)
    if (existing !== undefined) return existing
    const now = new Date().toISOString()
    return this.putScope({
      scopeKey: key,
      kind: 'rev',
      repoIdentity: input.repoIdentity,
      sessionId: null,
      eventSeq: null,
      turn: null,
      baseOid: input.baseOid,
      headOid: input.headOid,
      patchDigest: null,
      diffSpecDigest: normalizeDiffSpec(diffSpec),
      createdAt: now,
      updatedAt: now,
    })
  }
}
