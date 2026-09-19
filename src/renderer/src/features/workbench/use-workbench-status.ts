import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { AgentProjectActivitySnapshot } from '../../../../shared/contracts/agent-ipc'
import type { JobStatus } from '../../../../shared/contracts/jobs'
import { loadJobs } from '../knowledge/knowledge-sidebar-model'
import { reportWorkbenchError } from './use-workbench'

export function useWorkbenchStatus(projectSessionId: string) {
  const queryClient = useQueryClient()
  const [activity, setActivity] = useState<AgentProjectActivitySnapshot | null>(null)
  const [agentState, setAgentState] = useState<'loading' | 'ready' | 'unavailable'>('loading')
  const [jobsUnavailable, setJobsUnavailable] = useState(false)
  const jobs = useQuery({
    queryKey: ['knowledge-jobs', projectSessionId],
    queryFn: async () => {
      try {
        return await loadJobs({ projectSessionId, limit: 100 })
      } catch (err) {
        reportWorkbenchError(err, 'workbench.status.jobs')
        throw err
      }
    },
    retry: false
  })
  const index = useQuery({
    queryKey: ['knowledge-index-status', projectSessionId],
    queryFn: async () => {
      try {
        return await window.desktop.knowledge.indexStatus({ projectSessionId })
      } catch (err) {
        reportWorkbenchError(err, 'workbench.status.index')
        throw err
      }
    },
    refetchInterval: ({ state }) =>
      state.data?.readiness === 'preparing' ||
      (state.data?.readiness === 'available' && !state.data.indexed)
        ? 1_000
        : false,
    retry: false
  })
  useEffect(() => {
    let disposed = false
    let release: (() => void) | undefined
    setJobsUnavailable(false)
    const jobsKey = ['knowledge-jobs', projectSessionId]
    void window.desktop.jobs
      .subscribe({ projectSessionId }, ({ job }) => {
        if (disposed) return
        queryClient.setQueryData<JobStatus[]>(jobsKey, (previous) => [
          job,
          ...(previous ?? []).filter((item) => item.jobId !== job.jobId)
        ])
        if (job.state !== 'running') {
          for (const key of [
            'knowledge-items',
            'reference-items',
            'knowledge-index-status',
            'knowledge-job-history'
          ]) {
            void queryClient.invalidateQueries({ queryKey: [key, projectSessionId] })
          }
        }
      })
      .then((unsubscribe) => {
        if (disposed) unsubscribe()
        else {
          release = unsubscribe
          void queryClient.invalidateQueries({ queryKey: jobsKey })
        }
      })
      .catch((err) => {
        reportWorkbenchError(err, 'workbench.status.jobs.subscribe')
        if (!disposed) setJobsUnavailable(true)
      })
    return () => {
      disposed = true
      release?.()
    }
  }, [projectSessionId, queryClient])
  useEffect(
    () => watchAgentActivity(projectSessionId, setActivity, setAgentState),
    [projectSessionId]
  )

  return {
    activity,
    agentState,
    jobs: jobs.data ?? [],
    index: index.data,
    indexUnavailable: jobsUnavailable || jobs.isError || index.isError
  }
}

// The shell owns this listener even while the dockable Agent panel is unmounted.
export function watchAgentActivity(
  projectSessionId: string,
  setActivity: (snapshot: AgentProjectActivitySnapshot | null) => void,
  setAgentState: (state: 'loading' | 'ready' | 'unavailable') => void,
  api = window.desktop.agent,
  report = reportWorkbenchError
): () => void {
  setActivity(null)
  setAgentState('loading')
  let disposed = false
  let release: (() => void) | undefined
  void api
    .subscribeActivity({ projectSessionId }, (event) => {
      if (!disposed && event.kind === 'activity') setActivity(event.snapshot)
    })
    .then(async (subscription) => {
      if (disposed) {
        subscription.unsubscribe()
        return
      }
      release = subscription.unsubscribe
      setActivity(subscription.snapshot)
      await subscription.activate()
      if (!disposed) setAgentState('ready')
    })
    .catch((err) => {
      report(err, 'workbench.status.agent.subscribe')
      release?.()
      release = undefined
      if (!disposed) {
        setActivity(null)
        setAgentState('unavailable')
      }
    })
  return () => {
    disposed = true
    release?.()
  }
}
