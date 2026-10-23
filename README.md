# dsh-review-threads

Persistent, GitHub-style review threads for DeepSeek Harness diffs.

`dsh-review-threads` takes over the official `changes-review` tab and keeps the
official turn diff data source. A Review is bound to a diff and owns many
line-level Threads. User draft changes become visible to AI only when the user
submits a Review. AI can add comments immediately, but cannot delete or resolve
threads.

## Status

Version `0.1.0` is the first release. DeepSeek Harness itself remains in preview,
so review the compatibility range before installing.

## Requirements

- DeepSeek Harness `0.2.1-rc.1` through `0.2.1`
- Node.js 22.18 or newer
- Git for committed revision reviews

## Install

```bash
dsh plugin --profile web add dsh-review-threads
```

Restart the profile after installation. Removing the plugin restores the
official Review tab; review data stays under the profile's DSH storage.

## Review commands

- `/review` opens the current working-tree changes, including untracked files.
- `/review <base>..<head>` opens a committed revision range. Use
  `/review <base>...<head>` for merge-base comparison.
- Append `-- <paths...>` to limit either comparison to repository paths.
- Use `/review bind <base>..<head>` to open a range whose patch matches the
  current session's working Review; confirm the bind in the panel.
- `/review-diagnostics` reports storage counts without comment bodies.
- `/review-clear-drafts` discards unsubmitted drafts in the current session.

The command only opens the Review panel. It does not send a conversation
message or start an AI turn.

## Development

```bash
pnpm install
pnpm verify
```

## Documentation

- [Requirements](docs/requirements/requirements.md)
- [Design](docs/design.md)
- [Development plan](docs/development-plan.md)
- [Compatibility](docs/compatibility.md)
- [Decisions](docs/decisions/)

## License

MIT
