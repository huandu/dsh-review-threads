import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { fileAddressFor } from '@deepseek-ai/dsh-util-workspace-path'
import {
  diffUrl,
  parseReviewAddress,
  summaryUrl,
  type ReviewFileDiff,
  type ReviewSummary,
} from '../protocol.js'

interface ReviewTabInfo {
  readonly tab: {
    readonly contentId: string
    readonly signal: AbortSignal
    readonly actions: {
      openResource(address: string): void
    }
  }
}

interface SessionList {
  readonly byId: Readonly<
    Record<string, { readonly cwd?: string | undefined } | undefined>
  >
}

interface ReviewTabProps {
  readonly useTabInfo: () => ReviewTabInfo
  readonly sessionId: SessionId
  readonly useSessions: <Selected>(
    selector: (state: SessionList) => Selected,
  ) => Selected
}

type LoadState<T> =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'ready'; readonly value: T }

function useFetchState<T>(
  url: string | undefined,
  signal: AbortSignal,
): LoadState<T> | undefined {
  const [state, setState] = useState<LoadState<T>>()
  useEffect(() => {
    if (url === undefined) {
      setState(undefined)
      return
    }
    const request = new AbortController()
    const abort = (): void => {
      request.abort()
    }
    signal.addEventListener('abort', abort, { once: true })
    setState({ kind: 'loading' })
    void fetch(url, { signal: request.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
        return (await response.json()) as T
      })
      .then((value) => {
        if (!request.signal.aborted) setState({ kind: 'ready', value })
      })
      .catch((error: unknown) => {
        if (request.signal.aborted) return
        setState({
          kind: 'error',
          message: error instanceof Error ? error.message : String(error),
        })
      })
    return () => {
      signal.removeEventListener('abort', abort)
      request.abort()
    }
  }, [signal, url])
  return state
}

function status(text: string): ReactNode {
  return <p className="rt-status">{text}</p>
}

function diffBody(diff: ReviewFileDiff): ReactNode {
  if (diff.kind === 'binary')
    return status('Binary file. Changes cannot be shown.')
  if (diff.kind === 'oversized')
    return status('File too large. Changes cannot be shown.')
  if (diff.hunks.length === 0) return status('Both sides hold the same lines.')
  let oldLine = 0
  let newLine = 0
  return (
    <div className="rt-diff">
      {diff.hunks.map((hunk, hunkIndex) => {
        oldLine = hunk.oldStart
        newLine = hunk.newStart
        return (
          <section className="rt-hunk" key={hunkIndex}>
            <div className="rt-hunk-head">
              @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},
              {hunk.newLines} @@
            </div>
            {hunk.lines.map((line, lineIndex) => {
              const kind =
                line[0] === '+' ? 'add' : line[0] === '-' ? 'del' : 'context'
              const oldNumber = kind === 'add' ? '' : String(oldLine++)
              const newNumber = kind === 'del' ? '' : String(newLine++)
              return (
                <div className={`rt-line rt-${kind}`} key={lineIndex}>
                  <span className="rt-number">{oldNumber}</span>
                  <span className="rt-number">{newNumber}</span>
                  <span className="rt-sign">
                    {kind === 'add' ? '+' : kind === 'del' ? '-' : ' '}
                  </span>
                  <span className="rt-code">{line.slice(1)}</span>
                </div>
              )
            })}
          </section>
        )
      })}
    </div>
  )
}

const CSS = `
.rt-root{display:flex;flex-direction:column;height:100%;min-height:0;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family)}
.rt-head{display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid var(--dsw-alias-border-l3)}
.rt-file-select{min-width:0;flex:1;max-width:620px;padding:5px 8px;border:1px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-l1);color:inherit}
.rt-counts{display:flex;gap:8px;font-size:12px;color:var(--dsw-alias-label-tertiary);white-space:nowrap}
.rt-added{color:var(--dsw-alias-file-diff-added-marker)}.rt-deleted{color:var(--dsw-alias-file-diff-deleted-marker)}
.rt-open{border:0;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;padding:4px 6px;border-radius:6px}
.rt-open:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.rt-body{min-height:0;flex:1;overflow:auto;padding:8px 0 20px}
.rt-status{padding:16px;color:var(--dsw-alias-label-secondary)}
.rt-hunk{margin:0 0 14px}.rt-hunk-head{padding:4px 12px;color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-markdown-code-block);white-space:pre}
.rt-line{display:grid;grid-template-columns:3.5em 3.5em 1.2em minmax(0,1fr);min-height:22px;line-height:22px;white-space:pre;font:var(--dsw-font-markdown-code-block)}
.rt-number{text-align:right;padding-right:8px;color:var(--dsw-alias-label-tertiary);user-select:none}
.rt-sign{text-align:center;user-select:none}.rt-code{padding-right:16px;overflow:hidden;text-overflow:ellipsis}
.rt-add{background:var(--dsw-alias-file-diff-added-bg)}.rt-del{background:var(--dsw-alias-file-diff-deleted-bg)}
.rt-add .rt-number,.rt-add .rt-sign{color:var(--dsw-alias-file-diff-added-marker)}.rt-del .rt-number,.rt-del .rt-sign{color:var(--dsw-alias-file-diff-deleted-marker)}
@media (max-width:700px){.rt-head{flex-wrap:wrap}.rt-file-select{max-width:none;flex-basis:100%}.rt-line{grid-template-columns:2.8em 2.8em 1.2em minmax(0,1fr)}}
`

export function ReviewTab({
  useTabInfo,
  sessionId,
  useSessions,
}: ReviewTabProps): ReactNode {
  const { tab } = useTabInfo()
  const coordinates = useMemo(
    () => parseReviewAddress(tab.contentId),
    [tab.contentId],
  )
  const [selected, setSelected] = useState(0)
  const cwd = useSessions((sessions) => sessions.byId[sessionId]?.cwd)
  const summary = useFetchState<ReviewSummary>(
    coordinates === undefined
      ? undefined
      : summaryUrl(coordinates.sessionId, coordinates.seq),
    tab.signal,
  )
  const files = summary?.kind === 'ready' ? summary.value.files : []
  const index = files[selected] === undefined ? 0 : selected
  const file = files[index]
  const diff = useFetchState<ReviewFileDiff>(
    coordinates === undefined || file === undefined
      ? undefined
      : diffUrl(coordinates.sessionId, coordinates.seq, index),
    tab.signal,
  )

  if (coordinates === undefined)
    return <div className="rt-root">{status('Invalid review address.')}</div>
  return (
    <div className="rt-root">
      <style>{CSS}</style>
      <div className="rt-head">
        {file === undefined ? (
          <strong>Review · turn {coordinates.turn}</strong>
        ) : (
          <select
            className="rt-file-select"
            value={index}
            aria-label="Choose the file to review"
            onChange={(event) => {
              setSelected(Number(event.currentTarget.value))
            }}
          >
            {files.map((entry, at) => (
              <option value={at} key={entry.path}>
                {entry.display} (+{entry.added} -{entry.deleted})
              </option>
            ))}
          </select>
        )}
        {file !== undefined && (
          <>
            <span className="rt-counts">
              <span className="rt-added">+{file.added}</span>
              <span className="rt-deleted">-{file.deleted}</span>
            </span>
            <button
              className="rt-open"
              type="button"
              onClick={() => {
                tab.actions.openResource(
                  fileAddressFor(sessionId, cwd, file.path),
                )
              }}
            >
              Open file
            </button>
          </>
        )}
      </div>
      <div className="rt-body">
        {summary?.kind === 'loading' && status('Reading changes…')}
        {summary?.kind === 'error' &&
          status(`Could not read changes: ${summary.message}`)}
        {summary?.kind === 'ready' &&
          file === undefined &&
          status('This turn has no changed files.')}
        {diff?.kind === 'loading' && status('Reading comparison…')}
        {diff?.kind === 'error' &&
          status(`Could not read comparison: ${diff.message}`)}
        {diff?.kind === 'ready' && diffBody(diff.value)}
      </div>
    </div>
  )
}
