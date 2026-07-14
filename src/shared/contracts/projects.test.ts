import { describe, expect, it } from 'vitest'
import {
  activeProjectSchema,
  projectCreateInputSchema,
  projectLifecycleEventSchema,
  projectLifecycleSnapshotSchema,
  projectLifecycleStateSchema,
  recentProjectOpenInputSchema,
  recentProjectSchema,
  recentProjectsSchema,
  projectSelectionResultSchema,
  projectSessionInputSchema
} from './projects'

const activeProject = {
  projectId: '019c6a5c-8d34-7a8e-a602-3d37a52dc001',
  projectSessionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc002',
  displayName: '示例项目'
}

describe('project contracts', () => {
  it.each([
    'closed',
    'creating',
    'opening',
    'open',
    'closing',
    'recovery-required'
  ])('accepts the %s lifecycle state', (state) => {
    expect(projectLifecycleStateSchema.parse(state)).toBe(state)
  })

  it('accepts bounded renderer-safe active project metadata', () => {
    expect(activeProjectSchema.parse(activeProject)).toEqual(activeProject)
    expect(projectSelectionResultSchema.parse({ project: activeProject })).toEqual({
      project: activeProject
    })
    expect(projectSelectionResultSchema.parse({ project: null })).toEqual({ project: null })
  })

  it('accepts bounded recent project metadata and opaque open input', () => {
    const recentProject = {
      projectId: activeProject.projectId,
      displayName: '最近项目',
      projectPath: '/private/projects/recent.writellm',
      lastOpenedAt: '2026-07-14T12:00:00.000Z'
    }

    expect(recentProjectSchema.parse(recentProject)).toEqual(recentProject)
    expect(recentProjectsSchema.parse([recentProject])).toEqual([recentProject])
    expect(recentProjectOpenInputSchema.parse({ projectId: activeProject.projectId })).toEqual({
      projectId: activeProject.projectId
    })
    expect(() => recentProjectsSchema.parse(Array(6).fill(recentProject))).toThrow()
    expect(() =>
      recentProjectOpenInputSchema.parse({
        projectId: activeProject.projectId,
        projectPath: '/private/project'
      })
    ).toThrow()
  })

  it('requires an opaque session capability and rejects extra fields', () => {
    expect(
      projectSessionInputSchema.parse({ projectSessionId: activeProject.projectSessionId })
    ).toEqual({ projectSessionId: activeProject.projectSessionId })
    expect(() =>
      projectSessionInputSchema.parse({
        projectSessionId: activeProject.projectSessionId,
        projectRoot: '/private/project'
      })
    ).toThrow()
    expect(() =>
      activeProjectSchema.parse({ ...activeProject, projectSessionId: 'not-a-uuid' })
    ).toThrow()
  })

  it('accepts portable project names and rejects path-like or reserved names', () => {
    expect(projectCreateInputSchema.parse({ name: ' 研究项目 ' })).toEqual({ name: '研究项目' })
    for (const name of ['', '.', '..', '../escape', 'folder/name', 'name.', 'CON', 'bad:name']) {
      expect(() => projectCreateInputSchema.parse({ name })).toThrow()
    }
    expect(() => projectCreateInputSchema.parse({ name: '界'.repeat(100) })).toThrow()
  })

  it.each([
    { state: 'closed', activeProject: null },
    { state: 'creating', activeProject: null },
    { state: 'opening', activeProject: null },
    { state: 'open', activeProject },
    { state: 'closing', activeProject },
    { state: 'recovery-required', activeProject: null }
  ])('accepts a consistent $state snapshot', (snapshot) => {
    expect(projectLifecycleSnapshotSchema.parse(snapshot)).toEqual(snapshot)
  })

  it('binds lifecycle events to the active project session', () => {
    expect(
      projectLifecycleEventSchema.parse({
        projectSessionId: activeProject.projectSessionId,
        snapshot: { state: 'open', activeProject }
      })
    ).toEqual({
      projectSessionId: activeProject.projectSessionId,
      snapshot: { state: 'open', activeProject }
    })
    expect(() =>
      projectLifecycleEventSchema.parse({
        projectSessionId: activeProject.projectId,
        snapshot: { state: 'open', activeProject }
      })
    ).toThrow()
  })

  it.each([
    { state: 'open', activeProject: null },
    { state: 'closing', activeProject: null },
    { state: 'closed', activeProject },
    { state: 'opening', activeProject }
  ])('rejects an inconsistent $state snapshot', (snapshot) => {
    expect(() => projectLifecycleSnapshotSchema.parse(snapshot)).toThrow()
  })
})
