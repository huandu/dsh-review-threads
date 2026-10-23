import { domainTable, defineDomain } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'

const timestamp = z.iso.datetime()

export const scopeRecordSchema = z
  .object({
    scopeKey: z.string().min(1),
    kind: z.enum(['turn', 'work', 'rev']),
    repoIdentity: z.string().min(1).nullable(),
    sessionId: z.string().min(1).nullable(),
    eventSeq: z.number().int().nonnegative().nullable(),
    turn: z.number().int().positive().nullable(),
    baseOid: z.string().min(1).nullable(),
    headOid: z.string().min(1).nullable(),
    patchDigest: z.string().min(1).nullable(),
    diffSpecDigest: z.string().min(1).nullable(),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .strict()

export type ScopeRecord = z.infer<typeof scopeRecordSchema>

export const reviewThreadsDomain = defineDomain({
  name: 'review_threads',
  version: 1,
  layout: 'per-record',
  tables: {
    scopes: domainTable<string, ScopeRecord>(scopeRecordSchema),
  },
})
