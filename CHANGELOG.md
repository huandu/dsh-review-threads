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
