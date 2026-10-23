# ADR 0004: Bind working Reviews through verified patch identity

## Status

Accepted.

## Context

A working-tree Review and a committed revision Review may describe the same
patch. Automatically treating equal file lists as evidence would merge unrelated
reviews, while creating a second revision Review would lose discussion history.

## Decision

- A binding requires equal, non-empty patch digests. The digest covers the
  normalized file summary and every rendered file diff, including hunks and
  binary/oversized state.
- The working and revision scopes must have the same repository identity.
- The revision scope must be created from resolved commit OIDs and the same diff
  options used for the digest.
- A user must explicitly confirm binding in the revision Review panel.
- When the revision Review has no discussion history, the revision scope points
  at the working Review, so the Review ID and all entity IDs stay unchanged.
- When both Reviews contain history, the revision Review is the merge target.
  Thread, Comment, and Submission IDs are preserved.
- Duplicate line threads are merged into the target thread; the source thread is
  retained as a hidden tombstone so its content and identity are not
  reattached.
- Source and target drafts/submissions move under the target Review. The older
  Review decision is retained only when it is newer than the target decision.
- The old working scope remains a permanent alias of the target Review.
- Binding writes a durable `review_bindings` state before merging. A failed
  merge restores touched records and records `failed`; retry is idempotent.
  A process interrupted after `merging` can resume from the recorded source and
  target Review IDs.

## Consequences

In the common history-free case, stable `reviewId`, `threadId`, and
`submissionId` values remain usable across binding. A two-sided history conflict
must choose the revision Review ID as its aggregate identity.
Cross-scope duplicate anchors collapse to one visible thread. Storage-domain
operations are individually atomic rather than a backend transaction, so the
binding journal and rollback path are part of the durability contract.
