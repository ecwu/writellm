
import type { KnowledgeSourceTarget } from '../../shared/types';

export type Selection = { type: 'node'; id: string } | null;

export type AppPage = 'workspace' | 'knowledge' | 'project';

export type ChildViewMode = 'references' | 'markdown';

export type KnowledgeNavigationTarget = KnowledgeSourceTarget | null;
