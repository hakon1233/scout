<!-- topic: Open-source AI agents | today: 2026-10-04 | expect-fail: -->

## Open-source AI agents

- `2026-10-02` — Northwind Labs released version 2 of its agent runtime with sandboxed tool calls.
  [northwind.example — Agent runtime 2.0](https://northwind.example/blog/runtime-2)
  ![source image](https://northwind.example/img/runtime-2.png)
  > Northwind Labs shipped version 2 of its open-source agent runtime, adding sandboxed tool calls by default.
  >
  > Every tool call now runs in a separate process with no network access unless the tool's manifest asks for it; the release notes list 14 built-in tools that were moved to the new model.
  >
  > The maintainers say the change breaks plugins that wrote to the user's home directory, and a migration guide covers the three most common patterns.
  >
  > The project reports 2,100 contributors and a monthly release cadence, so plugin authors have until the November release before the old mode is removed.
- `2026-09-29` — The Example Foundation published a shared format for agent run traces.
  [examplefoundation.org — Trace format 1.0](https://examplefoundation.org/news/trace-format)
  > A foundation-backed working group published version 1.0 of a vendor-neutral trace format for agent runs.
  >
  > The format records each model call, tool call and result as an event with a parent id, so a run can be replayed step by step.
  >
  > Four agent frameworks have committed to emitting it by the end of the year, according to the announcement.
  >
  > The group says evaluation tools are the first intended users: a shared format lets one grader read runs from any framework.
- `2026-09-24` — A survey of 400 maintainers found most agent projects lack automated evals.
  [devsurvey.example — State of agent tooling](https://devsurvey.example/2026/agents)
  > A survey of 400 open-source maintainers found that 61% of agent projects run no automated evaluations.
  >
  > Respondents cited cost as the main reason: replaying real model calls in CI is slow and spends API credits.
  >
  > Projects that did run evals mostly checked output format rather than answer quality, the report notes.
  >
  > The authors recommend recorded-output tests as a cheap first step before model-graded evaluations.
