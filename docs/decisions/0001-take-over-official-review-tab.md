# 0001: Take over the official changes-review tab

## Context

The official `ui-deliverables` package renders a review tab but exposes no
line-level extension slot. Injecting buttons into its DOM would be fragile
across React reconciliation and theme changes.

## Decision

Register a plugin-owned `changes-review` tab at extension priority. Preserve the
official resource address and read diff data from `ctx.workspaceChanges`.

## Consequences

- The plugin owns the file selector and diff renderer.
- Official turn-tail cards continue to open the same Review tab address.
- Every supported DSH upgrade must run visual and functional diff parity tests.
