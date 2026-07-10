import { z } from 'zod';
import { generateLlmObject } from './llmRunner.js';
import type { ContentNodeRecord, ModelEndpointSettings } from '../shared/types.js';

const retrievalPlanSchema = z.object({
  queries: z.array(z.string().trim()).min(1).max(3)
});

const retrievalPlanJsonExample = JSON.stringify({
  queries: [
    'concise scholarly retrieval query for the central claim',
    'optional query for missing evidence or a counterargument'
  ]
});

export async function planKnowledgeRetrievalQueries(input: {
  prompt: string;
  articleSectionContext: string;
  contextNodes: ContentNodeRecord[];
  settings: ModelEndpointSettings;
  abortSignal?: AbortSignal;
}): Promise<string[]> {
  const contextNodes = input.contextNodes
    .map((node) => `${node.title}\n${node.content.trim().slice(0, 900)}`)
    .filter((text) => text.trim())
    .join('\n\n---\n\n')
    .slice(0, 2200);
  const result = await generateLlmObject(input.settings, {
    systemPrompt: [
      'You are a retrieval-planning agent for academic writing.',
      'Turn the writing request into one to three precise literature-retrieval queries.',
      'Use important concepts, evidence needs, and likely scholarly terminology. Do not explain your choices.'
    ].join('\n'),
    prompt: [
      'Writing request:',
      input.prompt,
      '',
      'Relevant article context:',
      input.articleSectionContext.slice(0, 6000),
      contextNodes ? ['', 'Selected writing context:', contextNodes].join('\n') : ''
    ].filter(Boolean).join('\n'),
    schema: retrievalPlanSchema,
    jsonExample: retrievalPlanJsonExample,
    maxOutputTokens: 900
  }, input.abortSignal);
  const queries = Array.from(new Set(result.queries.map(normalizeQuery).filter(Boolean))).slice(0, 3);
  if (queries.length === 0) {
    throw new Error('Retrieval planner returned no usable queries.');
  }
  return queries;
}

function normalizeQuery(query: string): string {
  return query.replace(/\s+/g, ' ').trim();
}
