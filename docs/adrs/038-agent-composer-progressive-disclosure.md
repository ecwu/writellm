# ADR 038: Agent Composer Progressive Disclosure

Status: accepted for Checkpoint 48; implementation authorized
Date: 2026-08-13

## Context

ADR 016 deliberately restored context, approval policy, model, Thinking, and Writing Skill to the
default Agent composer after ADR 015 hid them all in Details. Continued use now shows that placing
all five as independent compact controls creates a different failure: the writing prompt has two
rows of similarly weighted configuration, provider identity repeats information already apparent
from recognizable model names, and model choice is visually separated from the Thinking level it
constrains.

The user supplied the current Codex composer as the interaction reference. Its useful pattern is
not its computer-wide permission model; it is a restrained default surface with progressive
disclosure, a combined model/effort summary, and the same secondary actions reachable from an Add
menu or a leading slash. WriteLLM must preserve its narrower local-first authority and must not
present Codex labels that imply shell, arbitrary filesystem, or unrestricted network access.

## Decision

The idle Agent composer has four top-level action groups: Add, approval policy, combined model plus
effort, and Send. Context and Writing Skill remain directly reachable in one click through Add and
through an inline slash-command menu, and remain in Details. This supersedes ADR 016 only where it
requires each value to have an independent control on the default composer; all values remain
available without navigation to Settings.

Add and a leading `/` expose the same application-owned command catalog. The first version contains
only capabilities WriteLLM already owns: context scope and Writing Skill. The menu may select Auto,
selected text, current section, or whole manuscript context, and may select existing Writing Skill
choices in the same catalog. Slash selection performs configuration; it does not insert
hidden prompt text or add a new Agent tool, plugin, attachment, Goal, Plan, filesystem, browser, or
network capability.

The model trigger shows the selected model's concise display name followed by the exact
provider-neutral Thinking token when applicable, for example `GPT 5.6 Sol xhigh`. It omits the
provider name and logo from the collapsed trigger. The popover uses progressive submenus for Model
and Effort, derives Effort options from the selected model's supported levels, and disables Effort
when reasoning is unavailable. Provider identity remains visible while browsing the model list and
in Details, where it is needed to disambiguate duplicate model names and diagnose configuration.

Approval labels describe WriteLLM's actual mutation boundary:

- `Ask for approval`: review every proposed manuscript change.
- `Approve section edits`: automatically apply eligible section edits; other changes still pause.
- `Approve eligible edits`: automatically apply every change allowed by the existing policy.

The menu explains these limits and does not offer or imply computer-wide full access. Existing
Main-owned eligibility calculations, mandatory-review cases, run snapshot locking, conversation
persistence, and model/thinking/approval IPC remain authoritative.

## Alternatives Considered

- Keep all five controls visible and only shorten their labels. This preserves ADR 016 literally
  but does not remove duplicated hierarchy or connect model capability with effort.
- Move every setting back to Details. This recreates the ADR 015 discoverability problem and makes
  frequently changed choices slower.
- Copy Codex permission labels exactly. This would misrepresent WriteLLM's bounded proposal tools
  and create a dangerous expectation of filesystem or network authority.
- Flatten every provider's models into one unlabeled list. This makes the trigger concise but fails
  when two configured presets expose the same model name; provider grouping is therefore retained
  inside the picker.

## Consequences

The composer becomes quieter without removing any existing capability. Add and slash are two
entry gestures over one command definition, model and effort become one coherent decision, and the
collapsed model label no longer repeats provider branding. The tradeoff is one extra submenu step
for context, Writing Skill, or changing only the effort level.

Checkpoint 48 is Renderer and documentation work only. It adds no database migration, IPC method,
Agent tool, provider behavior, prompt change, permission, durable job, worker, dependency, release,
or hosted CI work. Existing sessions and remembered settings require no data migration.
