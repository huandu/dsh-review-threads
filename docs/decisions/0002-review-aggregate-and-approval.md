# 0002: Review aggregate and approval

## Context

Review verdicts apply to a diff, not an individual thread. Approval must be
explicit even when all threads are resolved, and approval must not terminate
future discussion.

## Decision

A Review is the persistent aggregate bound to one diff scope. Threads belong to
the Review. Each submission is an immutable ReviewSubmission carrying the
whole-Review verdict.

`approve` supersedes the current blocking verdict but does not resolve Threads
and does not close the Review. Manual Thread resolution never changes the
Review decision.

An independent Approve shortcut appears only when the Review has a blocking
verdict, code changed after that submission, and no draft is active. Starting
any draft hides the shortcut; the normal submission dialog still offers
approve and defaults to comment.
