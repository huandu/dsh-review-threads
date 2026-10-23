# 0003: Scope identity and persistence

## Context

Working diffs change across turns, while committed diff identities must remain
stable across sessions.

## Decision

Use three scope kinds:

- `turn:<session>:<eventSeq>:<patchDigest>`
- `work:<repoIdentity>:<session>:<baseOid>`
- `rev:<repoIdentity>:<baseOid>:<headOid>:<diffSpecDigest>`

Store data in the DSH `storageDomain` using a versioned, per-record domain.
Committed diff scopes use resolved commit IDs and diff options, never symbolic
refs.

Binding a working Review to a committed scope preserves Review, Thread, and
Submission IDs. If the target scope already owns a Review, merging requires user
confirmation and must be atomic.
