# Compatibility

## Supported DSH line

- Minimum: `0.2.1-rc.1`
- Tested: `0.2.1-rc.2`, `0.2.1-rc.3`
- Maximum: `<0.2.2-0`

## Public API dependencies

- `ctx.sidebarRightTabs` for overriding the built-in `changes-review` tab.
- `ctx.workspaceChanges` for turn summaries and file comparisons.
- `ctx.storageDomain` for Review, Thread, draft, and submission persistence.
- `ctx.connection.fetch` for authenticated HTTP and event routes.
- `ctx.tools` for model-facing thread tools.
- `ctx.commands` for `/review`.
- `ctx.systemPrompt` and the bundled skill for model guidance.

## Verification policy

Every supported DSH version must pass the full `pnpm verify` pipeline. A change
to the official Review address, tab registry, workspaceChanges types, or storage
domain contract requires a compatibility ADR before implementation.
