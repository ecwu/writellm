import type { AgentProjectActivitySnapshot } from '../../../../shared/contracts/agent-ipc'
import type { JobStatus } from '../../../../shared/contracts/jobs'
import type { KnowledgeIndexStatus } from '../../../../shared/contracts/knowledge'
import type { ContentTab } from './use-workbench'

export interface WorkbenchTask {
  id: string
  kind: 'agent' | 'notebook'
  label: string
  status: string
  active: boolean
  attention: boolean
}
export function indexLabel(
  index: KnowledgeIndexStatus | undefined,
  jobs: JobStatus[],
  unavailable: boolean
): string {
  if (unavailable || index?.readiness === 'unavailable') return 'Unavailable'
  if (!index) return 'Loading'
  if (
    jobs.some(
      (job) =>
        [
          'build_index_generation',
          'build_embedding_generation',
          'remove_index_item',
          'rebuild_index'
        ].includes(job.type) && ['queued', 'running'].includes(job.state)
    )
  )
    return 'Processing'
  if (index.readiness === 'preparing') return 'Preparing'
  return index.indexed ? 'Ready' : 'Not indexed'
}
export function workbenchTasks(
  activity: AgentProjectActivitySnapshot | null,
  tabs: ContentTab[],
  notebooks: Record<string, string>
): WorkbenchTask[] {
  return [
    ...(activity?.runs.map((run, index) => ({
      id: run.agentSessionId,
      kind: 'agent' as const,
      label: `Agent ${index + 1}`,
      status: {
        routing: 'Preparing',
        compacting: 'Compacting',
        running: 'Generating',
        awaiting_input: 'Needs input'
      }[run.phase],
      active: true,
      attention: run.phase === 'awaiting_input'
    })) ?? []),
    ...(activity?.compactions.map((run, index) => ({
      id: run.agentSessionId,
      kind: 'agent' as const,
      label: `Agent compaction ${index + 1}`,
      status: 'Compacting',
      active: true,
      attention: false
    })) ?? []),
    ...tabs.flatMap((tab) => {
      if (tab.kind !== 'notebook') return []
      const phase = notebooks[tab.notebookId] ?? 'loading'
      const labels: Record<string, string> = {
        idle: 'Idle',
        loading: 'Loading',
        thinking: 'Thinking',
        retrieving: 'Retrieving',
        generating: 'Generating',
        stopping: 'Stopping',
        error: 'Failed'
      }
      return [
        {
          id: tab.notebookId,
          kind: 'notebook' as const,
          label: `Notebook ${tab.number}`,
          status: labels[phase] ?? 'Unavailable',
          active: ['thinking', 'retrieving', 'generating', 'stopping'].includes(phase),
          attention: phase === 'error'
        }
      ]
    })
  ]
}
export function taskLabel(
  tasks: WorkbenchTask[],
  state: 'loading' | 'ready' | 'unavailable'
): string {
  if (state === 'unavailable') return 'Status unavailable'
  if (state === 'loading') return 'Loading'
  const attention = tasks.filter((task) => task.attention).length
  if (attention) return `${attention} need attention`
  const active = tasks.filter((task) => task.active).length
  return active ? `${active} running` : 'Idle'
}
