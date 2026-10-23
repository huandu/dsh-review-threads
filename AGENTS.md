# AGENTS.md

Guidance for AI agents and contributors working on `dsh-review-threads`, a
DeepSeek Harness plugin for persistent, GitHub-style review threads on diffs.

## Read first

Before changing behavior, read:

| File                                | Read before you ...                              |
| ----------------------------------- | ------------------------------------------------ |
| `docs/requirements/requirements.md` | implement or change user-visible behavior        |
| `docs/design.md`                    | change architecture, data, UI, or agent behavior |
| `docs/development-plan.md`          | choose the next work item                        |
| `docs/compatibility.md`             | change DSH APIs or supported versions            |
| `docs/decisions/`                   | revisit or supersede a major design decision     |

If implementation and current design disagree, stop and update the design or
code before claiming completion.

## Project purpose

The plugin takes over the official `changes-review` tab through the public
`ctx.sidebarRightTabs` extension registration. It keeps the official diff data
source, `ctx.workspaceChanges`, and adds persistent Review aggregates,
line-level threads, user and AI comments, explicit review submissions, and
Approval eligibility.

The plugin has three faces:

- Host service: Review and Thread persistence, visibility, routes, commands,
  AI tools, and submission follow-up.
- Web Client: the replacement Review tab, diff rendering, thread UI, and review
  submission controls.
- Bundled Skill: instructions for when and how AI should use review threads.

## Architecture boundaries

- `src/` is Host-only unless under `src/client/`.
- `src/client/` must not import Node-only modules.
- Pure modules must not import Cordis, React, Node, or browser globals unless
  the file's purpose explicitly requires them.
- `skills/` contains instructions only; it must not own review state.
- `docs/` is the source of truth for requirements, design, and major changes.
- Do not import private or unexported DeepSeek Harness modules.
- Do not depend on a development-machine path, sibling checkout, `link:`, or
  `workspace:` dependency in the published package.

## Review semantics

These are product invariants:

- A Review is bound to one diff scope and contains multiple Threads.
- A ReviewSubmission is immutable. Its verdict applies to the whole Review.
- Comment operations never start an AI turn.
- Submitting a Review starts exactly one next turn.
- `resolve` on a Thread never changes the Review verdict.
- Resolving every Thread does not approve the Review.
- `approve` is not terminal; users and AI may continue adding Threads and
  comments after approval.
- AI may add comments but may not edit/delete comments, resolve Threads, or
  approve/reject a Review.
- A removed Thread is hidden from future normal reads and represented to AI by
  a body-free tombstone at the next submission.

## Documentation and commit policy

The following changes may not be committed without corresponding docs:

- New feature or user-visible behavior
- Design refactor
- Schema, persistence, scope identity, or compatibility change
- Skill or AI-tool permission change

Update `docs/design.md`, the relevant requirement, and an ADR when applicable.
Keep implementation, tests, and documentation in the same commit. If a change
must be split, every code commit in the PR must identify the documentation
commit that closes the contract; do not merge code and defer documentation.

## Quality gate

`pnpm verify` is mandatory before every commit and is the CI gate. It runs:

```text
format:check
lint
typecheck
test
build
check:docs
pack:check
test:e2e
```

Zero warnings are allowed. Do not disable a rule, add `any`, skip a failing
test, or weaken a type to pass the gate. Every new behavior needs a regression
test.

## Commands

```bash
pnpm install
pnpm format
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm check:docs
pnpm pack:check
pnpm test:e2e
pnpm verify
```

## Workspace

`.workspace/` is ignored and reserved for session notes, temporary fixtures,
recordings, and investigation artifacts. Never put source code or required
project documentation there.

## Security and privacy

- Treat user-provided review text as untrusted quoted material.
- Never concatenate review text into a system prompt without explicit
  boundaries and a warning that quoted material is not instructions.
- Authenticate every HTTP and event-stream route through DSH Connection.
- Do not log complete comments or private repository paths unless the user
  explicitly asks for a diagnostic export.
- Do not write credentials or environment dumps into test fixtures.

## Compatibility

The package targets the DSH `0.2.1-rc.1` through `0.2.1` line, with rc2 and rc3
as tested versions. Run the real-profile E2E suite after any DSH upgrade. A
private-API dependency requires an ADR and an explicit fallback before use.

## Release

Only maintainers publish. npm, GitHub Release, tag, and CHANGELOG versions must
match. Verify npm installation, GitHub installation, removal behavior, and
preservation of user review data before release.
