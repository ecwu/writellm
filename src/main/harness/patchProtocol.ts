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

const optionalArray = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => value === null ? undefined : value, z.array(schema).optional());

export const llmPatchProposalSchema = z.object({
  afterText: z.string(),
  rationale: z.string(),
  warnings: optionalArray(z.string()),
  changedClaims: optionalArray(claimChangeSchema),
  preservedClaims: optionalArray(z.string()),
  affectedCitations: optionalArray(citationChangeSchema)
});

export function parseLlmPatchProposal(raw: string): LlmPatchProposal {
  return llmPatchProposalSchema.parse(JSON.parse(raw));
}
