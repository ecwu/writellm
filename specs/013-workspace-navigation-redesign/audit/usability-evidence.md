# Usability evidence: workspace navigation redesign

**Date**: 2026-07-13  
**Protocol status**: Representative-participant execution pending

## Participant accounting

| Cohort | Count | Counted toward SC-001/SC-002/SC-008 |
|---|---:|---|
| Representative authors | 0 | Yes, when recruited |
| Implementation evaluator / automated harness | 1 | No |

No representative author was available during implementation. Consequently, no completion time, correctness percentage, or 1–5 usability rating is reported as a participant result. Automated tests and the implementation evaluator are engineering evidence only and are not substitutes for the success criteria's representative-user sample.

## Protocol to execute

Recruit at least 10 representative authors who have not used this navigation implementation. Use the fixture project described in `quickstart.md`; randomize target names and alternate the starting category to reduce learning bias.

1. **SC-001 Section find-and-judge**: name a target Section, start the timer at the open project workspace, and stop when the participant opens it and states its writing status and chapter association. Record success only when all facts are correct within 30 seconds.
2. **SC-002 source find-and-judge**: name a target source, start the timer at the workspace, and stop when the participant opens it and states processing phase, total blocks, indexed range, and search eligibility. Record success only when all facts are correct within 30 seconds.
3. **SC-008 ratings**: after both tasks, independently rate “easy to understand my current location,” “easy to switch between Sections and Knowledge Base,” and “Settings location is clear” from 1 to 5.

The acceptance thresholds are at least 90% success for each timed task and at least 80% ratings of 4 or 5 for each of the three statements. Preserve anonymized raw task times, correctness fields, ratings, and observations alongside the aggregate before changing this audit to Passed.

## Engineering observations (not participant results)

- The automated 100-switch journey finished with the latest category selected and retained both owner DOM identities and draft values.
- DOM and compiled Electron checks found named Sections, Knowledge Base, and Settings controls and successfully opened Settings after switching categories.
- Baseline source-state fixtures distinguish queued, parsing, indexing, partial, available, failed, and retryable states using text rather than color alone.

## Caveats and disposition

- SC-001, SC-002, and SC-008 remain **Not measured** until the representative protocol above is run.
- Automated accessibility contracts cover names, state, targets, inertness, focus paths, forced-colors CSS, and constrained disclosure, but do not constitute a screen-reader participant study.
- T061 remains open. This is the only incomplete implementation-plan task and prevents declaring feature 013 fully accepted/complete.
