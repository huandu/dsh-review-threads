# Contributing

## Before coding

1. Open an issue describing the bug or feature.
2. Read `docs/requirements/requirements.md` and `docs/design.md`.
3. For a major design change, add an ADR under `docs/decisions/`.

## Branches and commits

Use `feature/<slug>` or `fix/<slug>` branches from `main`. Keep each commit
focused. Implementation, tests, and corresponding documentation must be in the
same commit.

## Verification

Run:

```bash
pnpm install
pnpm verify
```

CI runs the same command. Pull requests with warnings, failing tests, missing
docs, or a failing package check are not mergeable.

## Pull requests

A pull request must state:

- the problem and user-visible result;
- the design and compatibility impact;
- tests run;
- documentation updated;
- whether DSH profile E2E was run.

Maintainers merge pull requests. Contributors do not merge their own changes.
