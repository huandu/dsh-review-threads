export interface RealtimeEvent {
  readonly revision: number
  readonly at: string
}

type Listener = (event: RealtimeEvent) => void

export class RealtimeHub {
  private revision = 0
  private readonly listeners = new Set<Listener>()

  notify(): void {
    this.revision += 1
    const event = { revision: this.revision, at: new Date().toISOString() }
    for (const listener of this.listeners) listener(event)
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  get currentRevision(): number {
    return this.revision
  }
}

export function eventStream(
  hub: RealtimeHub,
  signal: AbortSignal,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  let unsubscribe: (() => void) | undefined
  let heartbeat: ReturnType<typeof setInterval> | undefined
  const cleanup = (): void => {
    unsubscribe?.()
    unsubscribe = undefined
    if (heartbeat !== undefined) clearInterval(heartbeat)
    heartbeat = undefined
  }
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: RealtimeEvent): void => {
        try {
          controller.enqueue(
            encoder.encode(
              `id: ${String(event.revision)}\ndata: ${JSON.stringify(event)}\n\n`,
            ),
          )
        } catch {
          cleanup()
        }
      }
      controller.enqueue(
        encoder.encode(
          `retry: 1500\nid: ${String(hub.currentRevision)}\ndata: ${JSON.stringify({ revision: hub.currentRevision, at: new Date().toISOString() })}\n\n`,
        ),
      )
      unsubscribe = hub.subscribe(send)
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': keepalive\n\n'))
        } catch {
          cleanup()
        }
      }, 15_000)
      signal.addEventListener('abort', cleanup, { once: true })
    },
    cancel() {
      cleanup()
    },
  })
}
