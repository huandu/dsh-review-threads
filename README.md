# dsh-review-threads

Persistent, GitHub-style review threads for DeepSeek Harness diffs.

`dsh-review-threads` takes over the official `changes-review` tab and keeps the
official turn diff data source. A Review is bound to a diff and owns many
line-level Threads. User draft changes become visible to AI only when the user
submits a Review. AI can add comments immediately, but cannot delete or resolve
threads.

## Status

The repository is under active development. Do not install it as a stable
release until version `0.1.0` is published.

## Requirements

- DeepSeek Harness `0.2.1-rc.1` through `0.2.1`
- Node.js 22.18 or newer
- Git for committed revision reviews

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
