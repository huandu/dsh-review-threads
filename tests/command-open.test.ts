import { describe, expect, it } from 'vitest'
import { reviewAddressFromCommand } from '../src/client/command-open.js'
import {
  REVISION_ADDRESS_PREFIX,
  REVIEW_OPEN_MARKER,
  WORK_ADDRESS_PREFIX,
} from '../src/protocol.js'

describe('review command acknowledgement', () => {
  it('extracts work and revision addresses only from a successful review command', () => {
    expect(
      reviewAddressFromCommand('review', {
        kind: 'success',
        text: `${REVIEW_OPEN_MARKER}${WORK_ADDRESS_PREFIX}work%3Arepo`,
      }),
    ).toEqual({ kind: 'work', scopeKey: 'work:repo' })
    expect(
      reviewAddressFromCommand('review', {
        kind: 'success',
        text: `${REVIEW_OPEN_MARKER}${REVISION_ADDRESS_PREFIX}rev%3Arepo`,
      }),
    ).toEqual({ kind: 'revision', scopeKey: 'rev:repo' })
    expect(
      reviewAddressFromCommand('other', {
        kind: 'success',
        text: `${REVIEW_OPEN_MARKER}${WORK_ADDRESS_PREFIX}work%3Arepo`,
      }),
    ).toBeUndefined()
  })
})
