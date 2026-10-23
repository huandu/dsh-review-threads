import { describe, expect, it } from 'vitest'
import { eventStream, RealtimeHub } from '../src/realtime.js'

describe('RealtimeHub', () => {
  it('broadcasts monotonic revisions', () => {
    const hub = new RealtimeHub()
    const revisions: number[] = []
    const unsubscribe = hub.subscribe((event) => revisions.push(event.revision))
    hub.notify()
    hub.notify()
    unsubscribe()
    hub.notify()
    expect(revisions).toEqual([1, 2])
  })

  it('starts an SSE stream with the current revision', async () => {
    const hub = new RealtimeHub()
    const controller = new AbortController()
    const stream = eventStream(hub, controller.signal)
    const reader = stream.getReader()
    const first = await reader.read()
    expect(new TextDecoder().decode(first.value)).toContain('id: 0')
    controller.abort()
    await reader.cancel()
  })
})
