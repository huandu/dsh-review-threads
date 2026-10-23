# Security Policy

## Reporting a vulnerability

Do not open a public issue for a vulnerability that exposes credentials, private
repository contents, review comments, or cross-session data. Report it privately
to the repository owner through GitHub Security Advisories.

## Data handled

The plugin stores review threads and comment text under the user's DSH storage
root. It may read local Git metadata and diffs when the user opens a revision
review. Review text is untrusted input and must never execute as HTML or become
unbounded system instructions.

## Supported versions

Security fixes target the latest published `0.1.x` release and the current DSH
compatibility line declared in `package.json`.
