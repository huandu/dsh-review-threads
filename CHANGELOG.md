# Changelog

## Unreleased

- Establish the plugin design, review aggregate, and project governance.
- Take over the official `changes-review` tab through the public extension registry.
- Proxy official turn summaries and file comparisons through authenticated Host
  routes.
- Add deterministic turn, working, and resolved-revision scope identities.
- Persist scope metadata through the DSH `storageDomain` contract.
- Model Reviews as persistent aggregates with immutable submissions.
- Add line-anchored Thread and Comment persistence, draft visibility, user and
  AI authorship rules, and body-free deletion tombstones.
- Add the in-panel review thread UI, line comment controls, reply composer,
  review draft controls, and permission-aware thread actions.
- Submit four review verdicts as immutable ReviewSubmissions and wake exactly
  one follow-up turn through `agent.followup()`.
- Add blocking-review detection, post-change Approve eligibility, and
  non-terminal approval behavior.
- Register the bundled `dsh-review-threads` skill plus model tools for listing,
  reading, and adding review comments with an explicit user-announcement
  obligation.
- Broadcast durable review changes over an authenticated SSE channel and refresh
  every open Review tab in the same Host process.
- Add `/review` for the current working tree, including untracked files, and
  resolved commit ranges with optional path filters.
- Persist working-tree snapshots across turns, re-anchor surviving threads, and
  share committed revision Reviews across sessions.
- Detect matching working and revision patches, require explicit confirmation,
  and bind them without changing Review, Thread, Comment, or Submission
  identities. Existing revision history merges with rollback.
- Add English and Chinese UI copy, keyboard/focus behavior, reduced-motion
  support, body-free diagnostics, and a session draft cleanup command.
- Cover acceptance scenarios AC-01 through AC-13 in the E2E suite.
- Bundle the workspace-path helper into the Web Client so DSH plugin loading
  does not depend on an unmaterialized package module.
