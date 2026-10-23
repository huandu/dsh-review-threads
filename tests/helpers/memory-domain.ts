import type { Context } from '@deepseek-ai/cordis'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { GitRunner } from '../../src/git.js'
import { reviewThreadsDomain } from '../../src/domain.js'
import { ReviewThreadService } from '../../src/service.js'

interface TableLike {
  get(key: string): unknown
  entries(): IterableIterator<[string, unknown]>
  put(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<boolean>
}

class MemoryTable implements TableLike {
  private readonly values = new Map<string, unknown>()

  get(key: string): unknown {
    return this.values.get(key)
  }

  entries(): IterableIterator<[string, unknown]> {
    return this.values.entries()
  }

  constructor(private readonly beforePut?: () => void) {}

  put(key: string, value: unknown): Promise<void> {
    this.beforePut?.()
    this.values.set(key, structuredClone(value))
    return Promise.resolve()
  }

  delete(key: string): Promise<boolean> {
    return Promise.resolve(this.values.delete(key))
  }
}

export interface MemoryServiceHarness {
  readonly service: ReviewThreadService
  readonly followups: readonly UserMessage[]
  failNextPut(table: string, afterCalls?: number): void
}

export function createMemoryService(options?: {
  readonly git?: GitRunner
  readonly cwd?: string
}): MemoryServiceHarness {
  const tables = new Map<string, MemoryTable>()
  const failures = new Map<string, number>()
  const domain = {
    table(name: string) {
      let table = tables.get(name)
      if (table === undefined) {
        table = new MemoryTable(() => {
          const remaining = failures.get(name)
          if (remaining === undefined) return
          if (remaining <= 1) {
            failures.delete(name)
            throw new Error(`Injected failure for ${name}`)
          }
          failures.set(name, remaining - 1)
        })
        tables.set(name, table)
      }
      return table
    },
  } as unknown as Domain<typeof reviewThreadsDomain>
  const followups: UserMessage[] = []
  const ctx = {
    agents: {
      get: () => ({
        followup: (message: UserMessage) => {
          followups.push(message)
        },
      }),
    },
    sessions: {
      get: () => ({
        header: { cwd: options?.cwd ?? '/workspace' },
      }),
    },
  } as unknown as Context
  return {
    service: new ReviewThreadService(
      ctx,
      domain,
      options?.git ?? ({} as GitRunner),
    ),
    followups,
    failNextPut(table, afterCalls = 1) {
      failures.set(table, afterCalls)
    },
  }
}

export function sessionId(value = 'session-1'): SessionId {
  return value as SessionId
}
