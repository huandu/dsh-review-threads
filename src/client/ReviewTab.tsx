import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { fileAddressFor } from '@deepseek-ai/dsh-util-workspace-path'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { flattenDiffLines, type DiffLine } from '../diff-lines.js'
import {
  ACTION_PATH,
  diffUrl,
  EVENTS_PATH,
  parseReviewAddress,
  revisionDiffUrl,
  revisionSummaryUrl,
  reviewStateUrl,
  scopeReviewStateUrl,
  summaryUrl,
  workDiffUrl,
  workSummaryUrl,
  type ReviewDecision,
  type ReviewFileDiff,
  type ReviewState,
  type ReviewSummary,
  type ReviewThreadView,
} from '../protocol.js'
type Translate = PropsLocale<'reviewThreads'>['t']

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
  readonly t: Translate
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
  return (
    <p className="rt-status" role="status">
      {text}
    </p>
  )
}

function unchanged(diff: ReviewFileDiff): boolean {
  return diff.kind === 'text' && diff.hunks.length === 0
}

function snapshotRevision(
  coordinates: NonNullable<ReturnType<typeof parseReviewAddress>>,
): string {
  return coordinates.kind === 'turn'
    ? `${coordinates.sessionId}:${String(coordinates.seq)}:${String(coordinates.turn)}`
    : coordinates.scopeKey
}

function addressTitle(
  coordinates: NonNullable<ReturnType<typeof parseReviewAddress>>,
  t: Translate,
): string {
  switch (coordinates.kind) {
    case 'turn':
      return t('title.turn', { turn: String(coordinates.turn) })
    case 'work':
      return t('title.work')
    case 'revision':
      return t('title.revision')
  }
}

const CSS = `
.rt-root{display:flex;flex-direction:column;height:100%;min-height:0;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family)}
.rt-head{display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid var(--dsw-alias-border-l3);flex-wrap:wrap}
.rt-file-select{min-width:0;flex:1;max-width:620px;padding:5px 8px;border:1px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-l1);color:inherit}
.rt-counts{display:flex;gap:8px;font-size:12px;color:var(--dsw-alias-label-tertiary);white-space:nowrap}
.rt-added{color:var(--dsw-alias-file-diff-added-marker)}.rt-deleted{color:var(--dsw-alias-file-diff-deleted-marker)}
.rt-decision{font-size:11px;padding:2px 7px;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
.rt-open,.rt-action{border:0;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;padding:4px 6px;border-radius:6px}
.rt-open:hover,.rt-action:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.rt-body{min-height:0;flex:1;overflow:auto;padding:8px 0 20px}
.rt-status{padding:16px;color:var(--dsw-alias-label-secondary)}
.rt-draft{position:sticky;bottom:0;z-index:3;background:var(--dsw-alias-bg-l1);border-top:1px solid var(--dsw-alias-border-l3);padding:8px 12px;display:grid;grid-template-columns:minmax(130px,180px) minmax(0,1fr) auto auto;gap:8px;align-items:center;box-shadow:0 -8px 24px color-mix(in srgb,var(--dsw-alias-bg-l0) 72%,transparent)}
.rt-binding{display:flex;gap:10px;align-items:center;padding:8px 12px;border-bottom:1px solid var(--dsw-alias-border-l3);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 8%,var(--dsw-alias-bg-l1));font-size:12px}
.rt-binding-copy{min-width:0;flex:1}
.rt-binding-warning{color:var(--dsw-alias-state-warning-primary)}
.rt-select,.rt-input,.rt-textarea{box-sizing:border-box;width:100%;border:1px solid var(--dsw-alias-border-l3);border-radius:6px;background:var(--dsw-alias-bg-l0);color:var(--dsw-alias-label-primary);padding:5px 7px;font:inherit}
.rt-textarea{min-height:54px;resize:vertical}
.rt-primary{border:0;border-radius:6px;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-on-brand);padding:6px 10px;cursor:pointer}
.rt-secondary{border:1px solid var(--dsw-alias-border-l3);border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);padding:5px 9px;cursor:pointer}
.rt-primary:disabled,.rt-secondary:disabled{opacity:.45;cursor:not-allowed}
.rt-root button:focus-visible,.rt-root select:focus-visible,.rt-root input:focus-visible,.rt-root textarea:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.rt-error{color:var(--dsw-alias-state-error-primary);font-size:12px;padding:0 12px 8px}
.rt-hunk{margin:0 0 14px}.rt-hunk-head{padding:4px 12px;color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-markdown-code-block);white-space:pre}
.rt-line{display:grid;grid-template-columns:3.5em 3.5em 1.2em 1.8em minmax(0,1fr);min-height:22px;line-height:22px;white-space:pre;font:var(--dsw-font-markdown-code-block)}
.rt-number{text-align:right;padding-right:8px;color:var(--dsw-alias-label-tertiary);user-select:none}
.rt-sign{text-align:center;user-select:none}.rt-code{padding-right:16px;overflow:hidden;text-overflow:ellipsis}
.rt-comment{justify-self:center;width:20px;height:19px;border:0;border-radius:4px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;font-size:10px;line-height:19px;padding:0}
.rt-comment:hover,.rt-comment[data-active=true]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-brand-primary)}
.rt-comment[data-count]:after{content:attr(data-count);font-weight:600}
.rt-add{background:var(--dsw-alias-file-diff-added-bg)}.rt-del{background:var(--dsw-alias-file-diff-deleted-bg)}
.rt-add .rt-number,.rt-add .rt-sign{color:var(--dsw-alias-file-diff-added-marker)}.rt-del .rt-number,.rt-del .rt-sign{color:var(--dsw-alias-file-diff-deleted-marker)}
.rt-thread{margin:0 12px 8px 9em;border:1px solid var(--dsw-alias-border-l3);border-radius:10px;background:var(--dsw-alias-bg-l1);min-width:260px}
.rt-thread-head{display:flex;gap:8px;align-items:center;padding:7px 10px;border-bottom:1px solid var(--dsw-alias-border-l3);font-size:12px;color:var(--dsw-alias-label-tertiary)}
.rt-spacer{flex:1}.rt-comments{padding:6px 10px}.rt-comment-item{padding:7px 0;border-bottom:1px solid var(--dsw-alias-border-l3)}.rt-comment-item:last-child{border-bottom:0}
.rt-comment-author{font-size:11px;color:var(--dsw-alias-label-tertiary);margin-bottom:3px}.rt-comment-body{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px}
.rt-inline-actions{display:flex;gap:6px;margin-top:5px}.rt-link{border:0;background:transparent;color:var(--dsw-alias-link);padding:0;font-size:11px;cursor:pointer}
.rt-compose{padding:8px 10px;display:flex;flex-direction:column;gap:6px}.rt-compose-actions{display:flex;justify-content:flex-end;gap:6px}
.rt-modal-backdrop{position:absolute;inset:0;z-index:20;background:color-mix(in srgb,var(--dsw-alias-bg-l0) 52%,transparent);display:flex;align-items:center;justify-content:center;padding:20px}
.rt-modal{width:min(520px,100%);border:1px solid var(--dsw-alias-border-l2);border-radius:14px;background:var(--dsw-alias-bg-l1);box-shadow:0 18px 50px color-mix(in srgb,var(--dsw-alias-bg-l0) 55%,transparent);padding:16px;display:flex;flex-direction:column;gap:12px}
.rt-modal h2{margin:0;font-size:16px}.rt-modal-actions{display:flex;justify-content:flex-end;gap:8px}
@media (max-width:700px){.rt-file-select{max-width:none;flex-basis:100%}.rt-line{grid-template-columns:2.8em 2.8em 1.2em 1.6em minmax(0,1fr)}.rt-thread{margin-left:10px;margin-right:10px}.rt-draft{grid-template-columns:1fr auto}.rt-draft .rt-select{grid-column:1/-1}.rt-draft .rt-input{grid-column:1/-1}}
@media (prefers-reduced-motion:reduce){.rt-root *{scroll-behavior:auto!important;transition:none!important;animation:none!important}}
`

function decisionLabel(decision: ReviewDecision | null, t: Translate): string {
  switch (decision) {
    case 'approve':
      return t('decision.approve')
    case 'comment':
      return t('decision.comment')
    case 'request_changes':
      return t('decision.request_changes')
    case 'reject':
      return t('decision.reject')
    case null:
      return t('decision.none')
  }
}

interface ThreadPanelProps {
  readonly thread: ReviewThreadView | undefined
  readonly line: DiffLine
  readonly busy: boolean
  readonly onAdd: (text: string) => Promise<void>
  readonly onDeleteComment: (commentId: string) => Promise<void>
  readonly onStatus: (status: 'open' | 'resolved') => Promise<void>
  readonly onDeleteThread: () => Promise<void>
  readonly onClose: () => void
  readonly t: Translate
}

function ThreadPanel(props: ThreadPanelProps): ReactNode {
  const [text, setText] = useState('')
  const submit = async (): Promise<void> => {
    const body = text.trim()
    if (body.length === 0) return
    await props.onAdd(body)
    setText('')
  }
  return (
    <div className="rt-thread">
      <div className="rt-thread-head">
        <span>
          {props.t('line.label', {
            side: props.t(
              props.line.side === 'old' ? 'line.side.old' : 'line.side.new',
            ),
            line: String(props.line.line),
          })}
        </span>
        {props.thread?.status === 'resolved' && (
          <span>{props.t('thread.resolved')}</span>
        )}
        <span className="rt-spacer" />
        {props.thread !== undefined && (
          <>
            <button
              className="rt-link"
              type="button"
              disabled={props.busy}
              onClick={() => {
                void props.onStatus(
                  props.thread?.status === 'resolved' ? 'open' : 'resolved',
                )
              }}
            >
              {props.thread.status === 'resolved'
                ? props.t('thread.reopen')
                : props.t('thread.resolve')}
            </button>
            <button
              className="rt-link"
              type="button"
              disabled={props.busy}
              onClick={() => {
                void props.onDeleteThread()
              }}
            >
              {props.t('thread.delete')}
            </button>
          </>
        )}
        <button className="rt-link" type="button" onClick={props.onClose}>
          {props.t('thread.close')}
        </button>
      </div>
      {props.thread !== undefined && (
        <div className="rt-comments">
          {props.thread.comments.map((comment) => (
            <article className="rt-comment-item" key={comment.commentId}>
              <div className="rt-comment-author">
                {comment.author === 'agent'
                  ? props.t('comment.ai')
                  : props.t('comment.you')}
                {comment.edited ? ` · ${props.t('comment.edited')}` : ''}
              </div>
              <p className="rt-comment-body">{comment.body}</p>
              {comment.author === 'user' && (
                <div className="rt-inline-actions">
                  <button
                    className="rt-link"
                    type="button"
                    disabled={props.busy}
                    onClick={() => {
                      void props.onDeleteComment(comment.commentId)
                    }}
                  >
                    {props.t('comment.delete')}
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
      <div className="rt-compose">
        <textarea
          className="rt-textarea"
          placeholder={
            props.thread === undefined
              ? props.t('comment.placeholder.new')
              : props.t('comment.placeholder.reply')
          }
          value={text}
          onChange={(event) => {
            setText(event.currentTarget.value)
          }}
        />
        <div className="rt-compose-actions">
          <button
            className="rt-primary"
            type="button"
            disabled={props.busy || text.trim().length === 0}
            onClick={() => {
              void submit()
            }}
          >
            {props.thread === undefined
              ? props.t('comment.add')
              : props.t('comment.reply')}
          </button>
        </div>
      </div>
    </div>
  )
}

function diffBody(
  diff: ReviewFileDiff,
  threads: readonly ReviewThreadView[],
  activeLine: string | undefined,
  setActiveLine: (key: string | undefined) => void,
  busy: boolean,
  onAdd: (line: DiffLine, text: string) => Promise<void>,
  onDeleteComment: (threadId: string, commentId: string) => Promise<void>,
  onStatus: (threadId: string, status: 'open' | 'resolved') => Promise<void>,
  onDeleteThread: (threadId: string) => Promise<void>,
  t: Translate,
): ReactNode {
  if (diff.kind === 'binary') return status(t('diff.binary'))
  if (diff.kind === 'oversized') return status(t('diff.oversized'))
  if (diff.hunks.length === 0) return status(t('diff.same'))
  const lines = flattenDiffLines(diff.hunks)
  const hunks = [...new Set(lines.map((line) => line.hunkIndex))]
  return (
    <div className="rt-diff">
      {hunks.map((hunkIndex) => {
        const hunkLines = lines.filter((line) => line.hunkIndex === hunkIndex)
        const first = hunkLines[0]
        if (first === undefined) return null
        return (
          <section className="rt-hunk" key={hunkIndex}>
            <div className="rt-hunk-head">{first.hunkHeader}</div>
            {hunkLines.map((line) => {
              const key = `${line.side}:${String(line.line)}`
              const matches = threads.filter(
                (thread) =>
                  thread.anchor.path === diff.path &&
                  thread.anchor.side === line.side &&
                  thread.anchor.line === line.line,
              )
              const thread = matches[0]
              const count = thread?.comments.length
              return (
                <div key={`${String(line.hunkIndex)}:${String(line.rowIndex)}`}>
                  <div className={`rt-line rt-${line.kind}`}>
                    <span className="rt-number">{line.oldLine ?? ''}</span>
                    <span className="rt-number">{line.newLine ?? ''}</span>
                    <span className="rt-sign">
                      {line.kind === 'add'
                        ? '+'
                        : line.kind === 'del'
                          ? '-'
                          : ' '}
                    </span>
                    <button
                      className="rt-comment"
                      type="button"
                      data-active={activeLine === key || undefined}
                      data-count={
                        count === undefined ? undefined : String(count)
                      }
                      title={t('line.comment', {
                        side: t(
                          line.side === 'old'
                            ? 'line.side.old'
                            : 'line.side.new',
                        ),
                        line: String(line.line),
                      })}
                      aria-label={t('line.comment', {
                        side: t(
                          line.side === 'old'
                            ? 'line.side.old'
                            : 'line.side.new',
                        ),
                        line: String(line.line),
                      })}
                      aria-expanded={activeLine === key}
                      onClick={() => {
                        setActiveLine(activeLine === key ? undefined : key)
                      }}
                    >
                      {count === undefined ? '+' : ''}
                    </button>
                    <span className="rt-code">{line.text}</span>
                  </div>
                  {activeLine === key && (
                    <ThreadPanel
                      thread={thread}
                      line={line}
                      busy={busy}
                      onAdd={(text) => onAdd(line, text)}
                      onDeleteComment={(commentId) =>
                        thread === undefined
                          ? Promise.resolve()
                          : onDeleteComment(thread.threadId, commentId)
                      }
                      onStatus={(nextStatus) =>
                        thread === undefined
                          ? Promise.resolve()
                          : onStatus(thread.threadId, nextStatus)
                      }
                      onDeleteThread={() =>
                        thread === undefined
                          ? Promise.resolve()
                          : onDeleteThread(thread.threadId)
                      }
                      onClose={() => {
                        setActiveLine(undefined)
                      }}
                      t={t}
                    />
                  )}
                </div>
              )
            })}
          </section>
        )
      })}
    </div>
  )
}

export function ReviewTab({
  useTabInfo,
  sessionId,
  useSessions,
  t,
}: ReviewTabProps): ReactNode {
  const { tab } = useTabInfo()
  const coordinates = useMemo(
    () => parseReviewAddress(tab.contentId),
    [tab.contentId],
  )
  const [selected, setSelected] = useState(0)
  const [refresh, setRefresh] = useState(0)
  const [activeLine, setActiveLine] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [dialog, setDialog] = useState<{
    readonly verdict: ReviewDecision
    readonly summary: string
  } | null>(null)
  const [bindingDialog, setBindingDialog] = useState(false)
  useEffect(() => {
    if (dialog === null && !bindingDialog) return
    const close = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      setDialog(null)
      setBindingDialog(false)
    }
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('keydown', close)
    }
  }, [bindingDialog, dialog])
  useEffect(() => {
    const source = new EventSource(EVENTS_PATH)
    source.onmessage = () => {
      setRefresh((value) => value + 1)
    }
    const close = (): void => {
      source.close()
    }
    tab.signal.addEventListener('abort', close, { once: true })
    return () => {
      tab.signal.removeEventListener('abort', close)
      source.close()
    }
  }, [tab.signal])
  const cwd = useSessions((sessions) => sessions.byId[sessionId]?.cwd)
  const summary = useFetchState<ReviewSummary>(
    coordinates === undefined
      ? undefined
      : coordinates.kind === 'turn'
        ? summaryUrl(coordinates.sessionId, coordinates.seq)
        : coordinates.kind === 'work'
          ? workSummaryUrl(coordinates.scopeKey)
          : revisionSummaryUrl(coordinates.scopeKey),
    tab.signal,
  )
  const files = summary?.kind === 'ready' ? summary.value.files : []
  const index = files[selected] === undefined ? 0 : selected
  const file = files[index]
  const diff = useFetchState<ReviewFileDiff>(
    coordinates === undefined || file === undefined
      ? undefined
      : coordinates.kind === 'turn'
        ? diffUrl(coordinates.sessionId, coordinates.seq, index)
        : coordinates.kind === 'work'
          ? workDiffUrl(coordinates.scopeKey, index)
          : revisionDiffUrl(coordinates.scopeKey, index),
    tab.signal,
  )
  const reviewBase =
    coordinates === undefined
      ? undefined
      : coordinates.kind === 'turn'
        ? reviewStateUrl(
            coordinates.sessionId,
            coordinates.seq,
            coordinates.turn,
          )
        : scopeReviewStateUrl(coordinates.scopeKey, sessionId, 0)
  const review = useFetchState<ReviewState>(
    reviewBase === undefined
      ? undefined
      : `${reviewBase}&refresh=${String(refresh)}`,
    tab.signal,
  )

  const act = async (body: Record<string, unknown>): Promise<boolean> => {
    if (review?.kind !== 'ready' || coordinates === undefined) return false
    setBusy(true)
    setError(undefined)
    try {
      const response = await fetch(ACTION_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...body,
          sessionId,
          reviewId: review.value.reviewId,
          turn: review.value.currentTurn,
        }),
      })
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          message?: unknown
        }
        throw new Error(
          typeof payload.message === 'string'
            ? payload.message
            : `HTTP ${String(response.status)}`,
        )
      }
      setRefresh((value) => value + 1)
      return true
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
      return false
    } finally {
      setBusy(false)
    }
  }

  if (coordinates === undefined) {
    return <div className="rt-root">{status(t('state.invalid'))}</div>
  }
  const threads = review?.kind === 'ready' ? review.value.threads : []
  const draft = review?.kind === 'ready' ? review.value.draft : null
  const decision =
    review?.kind === 'ready' ? review.value.currentDecision : null
  const approvalAvailable =
    review?.kind === 'ready' && review.value.approvalAvailable && draft === null
  const bindingSuggestion =
    review?.kind === 'ready' ? review.value.bindingSuggestion : null

  return (
    <div className="rt-root">
      <style>{CSS}</style>
      <div className="rt-head">
        {file === undefined ? (
          <strong>{addressTitle(coordinates, t)}</strong>
        ) : (
          <select
            className="rt-file-select"
            value={index}
            aria-label={t('file.choose')}
            onChange={(event) => {
              setSelected(Number(event.currentTarget.value))
              setActiveLine(undefined)
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
            <span className="rt-decision">{decisionLabel(decision, t)}</span>
            <button
              className="rt-open"
              type="button"
              onClick={() => {
                tab.actions.openResource(
                  fileAddressFor(sessionId, cwd, file.path),
                )
              }}
            >
              {t('file.open')}
            </button>
          </>
        )}
      </div>
      {error !== undefined && (
        <div className="rt-error" role="alert">
          {error}
        </div>
      )}
      {bindingSuggestion !== null && bindingSuggestion.patchMatches && (
        <div className="rt-binding">
          <span className="rt-binding-copy">
            {t('binding.copy')}
            {bindingSuggestion.targetHasHistory
              ? ` ${t('binding.conflict')}`
              : ''}
          </span>
          <button
            className="rt-secondary"
            type="button"
            disabled={busy}
            onClick={() => {
              setBindingDialog(true)
            }}
          >
            {t('binding.action')}
          </button>
        </div>
      )}
      <div className="rt-body">
        {summary?.kind === 'loading' && status(t('state.changes.loading'))}
        {summary?.kind === 'error' &&
          status(
            t('state.changes.failed', {
              message: summary.message,
            }),
          )}
        {review?.kind === 'loading' && status(t('state.review.loading'))}
        {review?.kind === 'error' &&
          status(
            t('state.review.failed', {
              message: review.message,
            }),
          )}
        {summary?.kind === 'ready' &&
          file === undefined &&
          status(t('state.changes.empty'))}
        {diff?.kind === 'loading' && status(t('state.diff.loading'))}
        {diff?.kind === 'error' &&
          status(
            t('state.diff.failed', {
              message: diff.message,
            }),
          )}
        {diff?.kind === 'ready' &&
          !unchanged(diff.value) &&
          diffBody(
            diff.value,
            threads,
            activeLine,
            setActiveLine,
            busy,
            async (line, text) => {
              await act({
                action: 'add_comment',
                anchor: {
                  path: file?.path,
                  side: line.side,
                  line: line.line,
                  startLine: line.line,
                  lineText: line.text,
                  beforeText: line.beforeText,
                  afterText: line.afterText,
                  hunkHeader: line.hunkHeader,
                  hunkText: line.hunkText,
                  snapshotRevision: snapshotRevision(coordinates),
                },
                body: text,
              })
            },
            async (threadId, commentId) => {
              await act({ action: 'delete_comment', threadId, commentId })
            },
            async (threadId, nextStatus) => {
              await act({
                action:
                  nextStatus === 'resolved'
                    ? 'resolve_thread'
                    : 'reopen_thread',
                threadId,
              })
            },
            async (threadId) => {
              await act({ action: 'delete_thread', threadId })
              setActiveLine(undefined)
            },
            t,
          )}
      </div>
      {draft !== null && (
        <div className="rt-draft">
          <select
            className="rt-select"
            value={draft.verdict}
            aria-label={t('draft.decision')}
            onChange={(event) => {
              void act({
                action: 'update_draft',
                verdict: event.currentTarget.value,
              })
            }}
          >
            <option value="comment">{t('decision.comment')}</option>
            <option value="approve">{t('decision.approve')}</option>
            <option value="request_changes">
              {t('decision.request_changes')}
            </option>
            <option value="reject">{t('decision.reject')}</option>
          </select>
          <input
            className="rt-input"
            placeholder={t('draft.summary')}
            defaultValue={draft.summaryText}
            onBlur={(event) => {
              if (event.currentTarget.value !== draft.summaryText) {
                void act({
                  action: 'update_draft',
                  verdict: draft.verdict,
                  summaryText: event.currentTarget.value,
                })
              }
            }}
          />
          <button
            className="rt-secondary"
            type="button"
            disabled={busy}
            onClick={() => {
              void act({ action: 'cancel_draft' })
            }}
          >
            {t('draft.cancel')}
          </button>
          <button
            className="rt-primary"
            type="button"
            disabled={busy}
            onClick={() => {
              setDialog({ verdict: draft.verdict, summary: draft.summaryText })
            }}
          >
            {t('draft.submit')}
          </button>
        </div>
      )}
      {approvalAvailable && (
        <div className="rt-draft">
          <span className="rt-decision">{t('draft.blocking')}</span>
          <span />
          <span />
          <button
            className="rt-primary"
            type="button"
            disabled={busy}
            onClick={() => {
              setDialog({ verdict: 'approve', summary: '' })
            }}
          >
            {t('draft.approve')}
          </button>
        </div>
      )}
      {dialog !== null && (
        <div className="rt-modal-backdrop" role="presentation">
          <div
            className="rt-modal"
            role="dialog"
            aria-modal="true"
            aria-label={t('submit.title')}
          >
            <h2>{t('submit.title')}</h2>
            <select
              className="rt-select"
              value={dialog.verdict}
              onChange={(event) => {
                setDialog({
                  ...dialog,
                  verdict: event.currentTarget.value as ReviewDecision,
                })
              }}
            >
              <option value="comment">{t('decision.comment')}</option>
              <option value="approve">{t('decision.approve')}</option>
              <option value="request_changes">
                {t('decision.request_changes')}
              </option>
              <option value="reject">{t('decision.reject')}</option>
            </select>
            <textarea
              className="rt-textarea"
              autoFocus
              placeholder={t('submit.summary')}
              value={dialog.summary}
              onChange={(event) => {
                setDialog({
                  ...dialog,
                  summary: event.currentTarget.value,
                })
              }}
            />
            <div className="rt-modal-actions">
              <button
                className="rt-secondary"
                type="button"
                autoFocus
                onClick={() => {
                  setDialog(null)
                }}
              >
                {t('submit.cancel')}
              </button>
              <button
                className="rt-primary"
                type="button"
                disabled={busy}
                onClick={() => {
                  void (async () => {
                    const saved = await act({
                      action: 'submit_review',
                      verdict: dialog.verdict,
                      summaryText: dialog.summary,
                    })
                    if (saved) setDialog(null)
                  })()
                }}
              >
                {t('submit.action')}
              </button>
            </div>
          </div>
        </div>
      )}
      {bindingDialog && bindingSuggestion !== null && (
        <div className="rt-modal-backdrop" role="presentation">
          <div
            className="rt-modal"
            role="dialog"
            aria-modal="true"
            aria-label={t('binding.title')}
          >
            <h2>{t('binding.title')}</h2>
            <p>{t('binding.description')}</p>
            {bindingSuggestion.targetHasHistory && (
              <p className="rt-binding-warning">{t('binding.merge')}</p>
            )}
            <div className="rt-modal-actions">
              <button
                className="rt-secondary"
                type="button"
                onClick={() => {
                  setBindingDialog(false)
                }}
              >
                {t('binding.cancel')}
              </button>
              <button
                className="rt-primary"
                type="button"
                disabled={busy}
                onClick={() => {
                  void (async () => {
                    const saved = await act({
                      action: 'bind_work_scope',
                      workScopeKey: bindingSuggestion.workScopeKey,
                    })
                    if (saved) setBindingDialog(false)
                  })()
                }}
              >
                {t('binding.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
