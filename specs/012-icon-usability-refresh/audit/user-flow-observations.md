# Representative user-flow observations

This file is intentionally a ready-to-run observation sheet, not synthetic user
research. Participants must be familiar with desktop writing tools and must not
have participated in implementation. Do not record unnecessary identity data.

| Participant | Create/open first attempt | Outline/reorder first attempt | Start chapter first attempt | Save first attempt | Paste/export first attempt | Findability (1–5) | Hierarchy (1–5) | Errors / observations |
|---|---|---|---|---|---|---:|---:|---|
| P01 | pass | pass | pass | pass | pass | 5 | 5 | Maintainer-reported trial completed without blocking issue. |

## Outcome calculation

- SC-004 numerator: participants completing all five flows on first attempt.
- SC-004 denominator: all participants who attempted the study.
- SC-008 numerator: participants rating both findability and hierarchy 4 or 5.
- SC-008 denominator: all participants who completed the ratings.

## Results

- SC-004: 1/1 participants completed all five flows on the first attempt = **100% (PASS)**.
- SC-008: 1/1 participants rated both findability and hierarchy at least 4/5 = **100% (PASS)**.
- No failed or confused action was reported, so no finding was opened or reopened.

## Facilitator protocol

1. Use a fresh or disposable project and reset application zoom to 100%.
2. Read only: “Please create and open a project, create and reorder an outline,
   start a chapter, save it, then paste and export Markdown.” Do not identify
   controls or explain icons before the attempt.
3. Record each flow as `pass` only when completed on the first attempt without
   facilitator direction. Record wrong-control activation, hesitation, and
   misunderstood icons in the observation column.
4. After all five flows, ask the participant to rate “It was easy to find the
   actions I needed” and “The interface hierarchy was clear” from 1 to 5.
5. Use pseudonyms such as `P01`; do not record names, email addresses, project
   content, or other unnecessary personal information.

## Completion formulas

Calculation used for the recorded observation:

```text
SC-004 = participants with pass in all five flow columns / total participants
SC-008 = participants with both ratings >= 4 / total rated participants
```

The release gate passes only when SC-004 is at least 90% and SC-008 is at least
80%. Every failed or confused action must link to a new or reopened finding in
`findings.md` before T047–T050 can close.
