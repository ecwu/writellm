import {
  type agentToolCallPayloadSchema,
  type agentToolResultPayloadSchema,
  readCitationsResultSchema,
  readSectionResultSchema,
  searchKnowledgeResultSchema
} from '../../../../shared/contracts/agent-tools'
import {
  agentDiagnosticErrorSchema,
  type AgentDiagnosticError
} from '../../../../shared/agent-diagnostic-error'

type AgentToolResultPayload = ReturnType<typeof agentToolResultPayloadSchema.parse>
type AgentToolCallPayload = ReturnType<typeof agentToolCallPayloadSchema.parse>

export interface AgentCitationDisplay {
  citationId: string
  title: string
  page?: number
}

export interface AgentToolActivity {
  eventId: string
  runId: string | null
  call: AgentToolCallPayload
  result: AgentToolResultPayload | null
  durationMs: number
  stopped: boolean
}

export type AgentThinkingVisualState =
  | 'working'
  | 'searching'
  | 'solving'
  | 'connecting'
  | 'composing'
  | 'shaping'
export type ToolStatus = 'running' | 'complete' | 'error' | 'stopped'

type ToolDefinition = {
  kind: 'activity' | 'change' | 'question'
  internal: boolean
  visual: AgentThinkingVisualState
  label: (tool: AgentToolActivity, running: boolean) => string
  summary: (tools: AgentToolActivity[]) => string
  citations?: (result: AgentToolResultPayload) => AgentCitationDisplay[]
}

function activity(
  running: string,
  complete: string,
  summary = complete,
  visual: AgentThinkingVisualState = 'searching',
  internal = false
): ToolDefinition {
  return {
    kind: 'activity',
    internal,
    visual,
    label: (_tool, active) => (active ? running : complete),
    summary: () => summary
  }
}
const change: ToolDefinition = {
  ...activity(
    'Preparing a reviewable change',
    'Prepared a reviewable change',
    'Prepared changes',
    'composing'
  ),
  kind: 'change'
}

export const AGENT_TOOL_PRESENTATIONS = {
  get_writing_context: activity(
    'Reading manuscript context',
    'Read manuscript context',
    'Reading the manuscript'
  ),
  read_outline: activity('Reading the outline', 'Read the outline', 'Reading the manuscript'),
  read_section: {
    ...activity('Reading a section', 'Read a section'),
    label: (tool, running) => {
      if (running) return 'Reading a section'
      const result =
        tool.result?.isError === false
          ? readSectionResultSchema.safeParse(tool.result.result)
          : null
      return result?.success ? `Read · ${result.data.section.title}` : 'Read a section'
    },
    summary: (tools) => `Read ${tools.length} ${tools.length === 1 ? 'section' : 'sections'}`
  },
  search_manuscript: activity(
    'Searching the manuscript',
    'Searched the manuscript',
    'Searching the manuscript'
  ),
  search_knowledge: {
    ...activity('Searching sources', 'Searched sources', 'Searching sources'),
    citations: sourceCitations
  },
  read_citations: {
    ...activity('Checking source evidence', 'Checked source evidence', 'Checking source evidence'),
    citations: sourceCitations
  },
  read_writing_skill: {
    ...activity('Loading writing guidance', 'Loaded writing guidance'),
    label: writingSkillActivityLabel,
    summary: summarizeWritingSkillActivity
  },
  ask_user: {
    ...activity(
      'Waiting for your answer',
      'Asked for clarification',
      'Asked for clarification',
      'connecting'
    ),
    kind: 'question'
  },
  activate_tool_groups: activity(
    'Preparing writing tools',
    'Prepared writing tools',
    'Prepared writing tools',
    'working',
    true
  ),
  inspect_change: activity(
    'Reviewing the change',
    'Reviewed the change',
    'Reviewing the change',
    'solving'
  ),
  list_comments: activity('Reading comments', 'Read comments', 'Reviewing comments'),
  read_comment: activity('Reading a comment', 'Read a comment', 'Reviewing comments'),
  reply_comment: activity('Replying to a comment', 'Replied to a comment', 'Handling comments'),
  resolve_comment: activity(
    'Verifying a comment',
    'Resolved a comment',
    'Handling comments',
    'solving'
  ),
  get_writing_task: activity(
    'Reading the writing plan',
    'Read the writing plan',
    'Updating the writing plan',
    'searching',
    true
  ),
  create_writing_task: activity(
    'Creating the writing plan',
    'Created the writing plan',
    'Updating the writing plan',
    'working',
    true
  ),
  update_writing_task: activity(
    'Updating the writing plan',
    'Updated the writing plan',
    'Updating the writing plan',
    'working',
    true
  ),
  submit_brief_change: change,
  submit_writing_rules_change: change,
  submit_outline_change: change,
  submit_section_change: change,
  propose_brief_update: change,
  propose_outline_patch: change,
  propose_section_patch: change,
  generate_image: {
    ...change,
    visual: 'shaping',
    label: (_tool, running) => (running ? 'Generating an image' : 'Generated an image')
  }
} satisfies Record<AgentToolCallPayload['toolName'], ToolDefinition>

export interface AgentToolPresentation extends AgentToolActivity {
  status: ToolStatus
  statusLabel: string
  label: string
  kind: ToolDefinition['kind']
  internal: boolean
  visual: AgentThinkingVisualState
  citations: AgentCitationDisplay[]
  diagnostic: AgentDiagnosticError | undefined
  recoveryLabel: string | null
}

export function presentAgentTool(tool: AgentToolActivity): AgentToolPresentation {
  const definition: ToolDefinition = AGENT_TOOL_PRESENTATIONS[tool.call.toolName]
  const status = toolWasStopped(tool)
    ? 'stopped'
    : tool.result === null
      ? 'running'
      : tool.result.isError
        ? 'error'
        : 'complete'
  const diagnostic = agentDiagnosticErrorSchema.safeParse(tool.result?.error?.details)
  const recovery = tool.result?.error?.recovery
  const target = recovery?.uri ?? recovery?.tool
  return {
    ...tool,
    status,
    statusLabel: { running: 'Running', stopped: 'Stopped', error: 'Error', complete: 'Complete' }[
      status
    ],
    label: definition.label(tool, status === 'running'),
    kind: definition.kind,
    internal: definition.internal,
    visual: definition.visual,
    citations: tool.result === null ? [] : citationDisplaysForToolResult(tool.result),
    diagnostic: diagnostic.success ? diagnostic.data : undefined,
    recoveryLabel:
      recovery === undefined
        ? null
        : `Recovery: ${recovery.action}${target === undefined ? '' : ` with ${target}`}`
  }
}

export function agentToolActivityLabel(tool: AgentToolActivity): string {
  return AGENT_TOOL_PRESENTATIONS[tool.call.toolName].label(
    tool,
    tool.result === null && !toolWasStopped(tool)
  )
}
export function toolWasStopped(tool: AgentToolActivity): boolean {
  return tool.stopped || tool.result?.error?.code === 'aborted'
}
export function summarizeAgentActivity(tools: AgentToolActivity[]): string {
  const groups = new Map<AgentToolCallPayload['toolName'], AgentToolActivity[]>()
  for (const tool of tools) {
    const group = groups.get(tool.call.toolName) ?? []
    group.push(tool)
    groups.set(tool.call.toolName, group)
  }
  return joinSummaryParts([
    ...new Set([...groups].map(([name, items]) => AGENT_TOOL_PRESENTATIONS[name].summary(items)))
  ])
}

export function citationDisplaysForToolResult(
  result: AgentToolResultPayload
): AgentCitationDisplay[] {
  if (result.isError) return []
  const definition: ToolDefinition = AGENT_TOOL_PRESENTATIONS[result.toolName]
  return (
    definition.citations?.(result) ??
    result.citationIds.map((citationId) => ({ citationId, title: citationId }))
  )
}
function sourceCitations(result: AgentToolResultPayload): AgentCitationDisplay[] {
  const displays = new Map<string, AgentCitationDisplay>()
  if (result.toolName === 'search_knowledge') {
    const parsed = searchKnowledgeResultSchema.safeParse(result.result)
    if (parsed.success) {
      for (const hit of parsed.data.hits) {
        displays.set(hit.citationId, {
          citationId: hit.citationId,
          title: hit.title,
          ...(hit.page === undefined ? {} : { page: hit.page })
        })
      }
    }
  } else if (result.toolName === 'read_citations') {
    const parsed = readCitationsResultSchema.safeParse(result.result)
    if (parsed.success) {
      for (const citation of parsed.data.citations) {
        displays.set(citation.citationId, {
          citationId: citation.citationId,
          title: citation.title,
          ...(citation.page === undefined ? {} : { page: citation.page })
        })
      }
    }
  }

  return [...new Set(result.citationIds)].map(
    (citationId) => displays.get(citationId) ?? { citationId, title: citationId }
  )
}

type WritingSkillActivityIdentity = {
  displayName: string
  relativePath: string
}

function writingSkillActivityIdentity(tool: AgentToolActivity): WritingSkillActivityIdentity {
  const projected = tool.result?.result
  const projectedName =
    projected !== null && typeof projected?.displayName === 'string' ? projected.displayName : null
  const projectedPath =
    projected !== null && typeof projected?.relativePath === 'string'
      ? projected.relativePath
      : null
  const argumentName =
    typeof tool.call.args.displayName === 'string' ? tool.call.args.displayName : null
  const argumentPath =
    typeof tool.call.args.relativePath === 'string' ? tool.call.args.relativePath : null
  const uri = typeof tool.call.args.uri === 'string' ? tool.call.args.uri : ''
  const match = /^writellm:\/\/skills\/([^/]+)\/[a-f0-9]{40}\/(.+)$/u.exec(uri)
  const skillId = match?.[1] ?? 'writing-skill'
  return {
    displayName: projectedName ?? argumentName ?? humanizeSkillId(skillId),
    relativePath: projectedPath ?? argumentPath ?? match?.[2] ?? 'SKILL.md'
  }
}

function humanizeSkillId(skillId: string): string {
  const name = skillId.split(':').at(-1) ?? skillId
  return name
    .split('-')
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toLocaleUpperCase()}${part.slice(1)}`)
    .join(' ')
}

function summarizeWritingSkillActivity(tools: AgentToolActivity[]): string {
  const skillTools = tools.filter((tool) => tool.call.toolName === 'read_writing_skill')
  const successful = skillTools.filter((tool) => tool.result !== null && !tool.result.isError)
  const entrypoints = successful.filter(
    (tool) => writingSkillActivityIdentity(tool).relativePath === 'SKILL.md'
  )
  const references = successful.filter(
    (tool) => writingSkillActivityIdentity(tool).relativePath !== 'SKILL.md'
  )
  const parts: string[] = []
  if (entrypoints.length === 1) {
    parts.push(`Loaded ${writingSkillActivityIdentity(entrypoints[0]).displayName}`)
  } else if (entrypoints.length > 1) {
    parts.push(`Loaded ${entrypoints.length} Writing Skills`)
  }
  if (references.length > 0) {
    parts.push(
      `${references.length} ${references.length === 1 ? 'reference file' : 'reference files'}`
    )
  }
  if (parts.length > 0) return parts.join(' · ')
  const running = skillTools.find((tool) => tool.result === null && !toolWasStopped(tool))
  if (running !== undefined) {
    const identity = writingSkillActivityIdentity(running)
    return identity.relativePath === 'SKILL.md'
      ? `Loading ${identity.displayName}`
      : `Reading ${identity.displayName} · ${identity.relativePath}`
  }
  return 'Writing Skill loading failed'
}

function writingSkillActivityLabel(tool: AgentToolActivity, running: boolean): string {
  const identity = writingSkillActivityIdentity(tool)
  const entrypoint = identity.relativePath === 'SKILL.md'
  if (running) {
    return entrypoint
      ? `Loading ${identity.displayName}`
      : `Reading ${identity.displayName} · ${identity.relativePath}`
  }
  if (tool.result?.isError === true || toolWasStopped(tool)) {
    return entrypoint
      ? `Could not load ${identity.displayName}`
      : `Could not read ${identity.displayName} · ${identity.relativePath}`
  }
  return entrypoint
    ? `Loaded ${identity.displayName} · SKILL.md`
    : `Read ${identity.displayName} · ${identity.relativePath}`
}

function joinSummaryParts(parts: string[]): string {
  if (parts.length === 1) return parts[0] ?? 'Worked on the request'
  return parts
    .map((part, index) => (index === 0 ? part : `${part.charAt(0).toLowerCase()}${part.slice(1)}`))
    .join(', ')
}
