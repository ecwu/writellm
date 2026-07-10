
import type { FocusedWorkspaceState } from '../../shared/types';

export const emptyState: FocusedWorkspaceState = {
  workspace: null,
  projectBrief: {
    glossary: { entries: [], notes: '' },
    motivation: {
      audience: '',
      problem: '',
      thesis: '',
      contribution: '',
      desiredReaderAction: '',
      constraints: '',
      notes: ''
    },
    framework: { narrativeArc: '', sectionPlan: [], notes: '' },
    createdAt: null,
    updatedAt: null
  },
  compositionTree: [],
  focusSectionId: null,
  nodes: [],
  visibleNodes: [],
  contextNodes: [],
  knowledgeItems: [],
  knowledgeIngestJobs: [],
  nodeStats: {},
  edges: []
};
