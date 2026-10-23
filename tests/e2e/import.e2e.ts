import { describe, expect, it } from 'vitest'
import { apply, name } from '../../src/index.js'

describe('Host entry', () => {
  it('exports the plugin identity', () => {
    expect(name).toBe('dsh-review-threads')
    expect(apply).toBeTypeOf('function')
  })
})
