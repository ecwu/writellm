import { z } from 'zod';
import type { LlmPatchProposal } from '../../shared/types.js';

const claimChangeSchema = z.object({
  claimText: z.string(),
  changeType: z.enum(['preserved', 'added', 'removed', 'weakened', 'strengthened', 'rephrased', 'unknown']),
  before: z.string().optional(),
  after: z.string().optional(),
  requiresReview: z.boolean()
});

const citationChangeSchema = z.object({
  citation: z.string(),
  changeType: z.enum(['preserved', 'added', 'removed', 'moved', 'modified', 'unknown']),
  requiresReview: z.boolean()
});

export const llmPatchProposalSchema = z.object({
  afterText: z.string(),
  rationale: z.string(),
  warnings: z.array(z.string()).optional(),
  changedClaims: z.array(claimChangeSchema).optional(),
  preservedClaims: z.array(z.string()).optional(),
  affectedCitations: z.array(citationChangeSchema).optional()
});

export function parseLlmPatchProposal(raw: string): LlmPatchProposal {
  return llmPatchProposalSchema.parse(JSON.parse(raw));
}

