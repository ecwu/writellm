# WriteLLM Planning Documentation

Before any project work, read the Master Product PRD and Project task tracker. Then read the initiative PRD and ADRs that are linked to the task you intend to claim.

| Document | Use it for |
| --- | --- |
| [Master Product PRD](project-prd.md) | Product scope, requirements, initiative routing, priorities, and release gates. |
| [Project task tracker](task-tracker.md) | Claiming, assigning, updating, blocking, reviewing, and completing every task. This is the only live task-status source. |
| [Pi Agent Harness initiative PRD](pi-agent-harness-prd.md) | Read only for a PIA task: Pi-specific requirements, dependency design, acceptance criteria, and PIA requirement-to-task traceability. |
| [ADR register](adr/README.md) | Architecture decisions, their alternatives/constraints, and decision-level implementation state. |

## Rule of ownership

- Master PRD: what WriteLLM is and must achieve.
- Initiative PRD: what a bounded initiative must achieve.
- Task tracker: who is doing what, when, with what evidence.
- ADR: why the architecture is the way it is and whether that decision is implemented.

Do not copy a task's live status into an initiative PRD or ADR. Link to its permanent task ID in [task-tracker.md](task-tracker.md) instead.
