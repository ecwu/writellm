import type {
  GenerationMode,
  GenerationRoundRecord,
  GenerationSessionRecord,
  LlmPatchProposal,
  SectionLlmEditMode,
  SectionNodeRecord,
  WritingPatch,
  WritingPatchRecord
} from '../shared/types.js';
import type { WriteLLMDatabase } from './database.js';
import { createId, nowIso } from './ids.js';
import { createPatchDiff } from './harness/patchDiff.js';
import { parseLlmPatchProposal } from './harness/patchProtocol.js';
import { hashText, scanCitations } from './harness/patchScanners.js';
import { beforeAfterForPatch, validateWritingPatch } from './harness/patchValidator.js';

type GenerationApplyPayload =
  | {
      kind: 'edit';
      sectionId: string;
      focusSectionId: string | null;
      mode: SectionLlmEditMode;
      insertionMode?: 'cursor' | 'section_end';
      userPrompt: string;
      resolvedPrompt: string;
      systemPrompt: string;
      baseMarkdown: string;
      targetStart: number;
      targetEnd: number;
      selectedText: string;
      prefixContext: string;
      suffixContext: string;
      contextNodeIds: string[];
    };

export function createPatchFromGenerationRound(
  db: WriteLLMDatabase,
  roundId: string
): WritingPatchRecord {
  const existing = db.getWritingPatchForGenerationRound(roundId);
  if (existing) {
    return existing;
  }
  const round = db.getGenerationRound(roundId);
  if (!round) {
    throw new Error(`Generation round not found: ${roundId}`);
  }
  if (round.status !== 'done' || !round.content?.trim()) {
    throw new Error('Only completed generation tasks can be converted into WritingPatch records.');
  }
  const session = db.getGenerationSession(round.sessionId);
  if (!session) {
    throw new Error(`Generation session not found: ${round.sessionId}`);
  }
  const applyPayload = parseGenerationApplyPayload(db.getGenerationRoundApplyPayload(round.id));
  const section = db.getSection(applyPayload.sectionId);
  if (!section) {
    throw new Error(`Section not found: ${applyPayload.sectionId}`);
  }

  let proposal: LlmPatchProposal;
  try {
    proposal = parseLlmPatchProposal(round.content);
  } catch (caught) {
    const patch = buildWritingPatchFromProposal({
      db,
      round,
      session,
      applyPayload,
      section,
      proposal: {
        afterText: '',
        rationale: 'The model response could not be parsed as a WritingPatch proposal.',
        warnings: [caught instanceof Error ? caught.message : String(caught)]
      },
      rawProposal: round.content,
      parseFailed: true
    });
    const saved = db.createWritingPatch(patch);
    db.updateGenerationRound(round.id, { status: 'patch_created', patchId: saved.id });
    return saved;
  }

  const patch = buildWritingPatchFromProposal({
    db,
    round,
    session,
    applyPayload,
    section,
    proposal,
    rawProposal: round.content,
    parseFailed: false
  });
  const saved = db.createWritingPatch(patch);
  db.updateGenerationRound(round.id, { status: 'patch_created', patchId: saved.id });
  return saved;
}

function buildWritingPatchFromProposal(input: {
  db: WriteLLMDatabase;
  round: GenerationRoundRecord;
  session: GenerationSessionRecord;
  applyPayload: GenerationApplyPayload;
  section: SectionNodeRecord;
  proposal: LlmPatchProposal;
  rawProposal: string;
  parseFailed: boolean;
}): WritingPatch {
  const { round, session, applyPayload, section, proposal } = input;
  const timestamp = nowIso();
  const beforeText = selectedTextForLlmEdit(
    applyPayload.mode,
    applyPayload.baseMarkdown,
    applyPayload.targetStart,
    applyPayload.targetEnd
  );
  const kind = writingPatchKindForApplyPayload(applyPayload);
  const afterText = proposal.afterText;
  const operation: WritingPatch['operation'] = kind === 'replace_selection' || kind === 'replace_section'
    ? { type: 'replace', before: beforeText, after: afterText }
    : kind === 'insert_at_cursor'
      ? { type: 'insert', text: afterText, position: 'at' }
      : {
          type: 'create_candidate',
          candidateTitle: `${generationModeLabel(round.mode)} · ${section.title}`,
          content: afterText,
          relationToSource: 'revises'
        };
  const patch: WritingPatch = {
    id: createId('wpatch'),
    kind,
    status: input.parseFailed ? 'parse_failed' : 'proposed',
    origin: {
      source: 'llm',
      generationSessionId: session.id,
      generationRoundId: round.id,
      model: round.modelProvider && round.modelName
        ? {
            provider: round.modelProvider,
            modelName: round.modelName,
            endpointType: round.modelProvider === 'anthropic-compatible' ? 'anthropic-compatible' : 'openai-compatible'
          }
        : undefined,
      promptHash: hashText(round.resolvedPrompt ?? round.prompt),
      createdAt: timestamp
    },
    target: {
      workspaceId: input.db.workspacePath,
      sectionId: applyPayload.sectionId,
      targetMode: kind === 'create_content_candidate' ? 'new_content_node' : 'section_markdown_file',
      location: kind === 'replace_selection'
        ? {
            type: 'text_range',
            startOffset: applyPayload.targetStart,
            endOffset: applyPayload.targetEnd,
            selectedText: beforeText
          }
        : kind === 'insert_at_cursor'
          ? {
              type: 'insertion',
              mode: applyPayload.insertionMode === 'section_end' ? 'section_end' : 'cursor',
              offset: applyPayload.targetStart,
              insertionAffinity: 'after'
            }
          : {
              type: 'section',
              sectionHash: section.markdownHash
            }
    },
    anchors: {
      baseSectionHash: section.markdownHash,
      beforeText,
      beforeTextHash: hashText(beforeText),
      prefixContext: applyPayload.prefixContext,
      suffixContext: applyPayload.suffixContext,
      anchorStrategy: kind === 'replace_section' ? 'section_replace' : kind === 'create_content_candidate' ? 'candidate_only' : 'hash_and_range'
    },
    operation,
    metadata: {
      title: `${generationModeLabel(round.mode)} patch`,
      userGoal: applyPayload.userPrompt,
      actionType: round.mode === 'rewrite_section' || round.mode === 'rewrite_selection' ? 'revise' : 'draft',
      rationale: proposal.rationale,
      warnings: proposal.warnings,
      changedClaims: proposal.changedClaims,
      preservedClaims: proposal.preservedClaims,
      affectedCitations: proposal.affectedCitations,
      rawProposal: input.rawProposal,
      provenance: {
        generationRoundId: round.id,
        retrievedChunkIds: round.retrievedSources.map((source) => source.chunkId),
        citationMarkers: scanCitations(afterText)
      }
    },
    review: { decision: 'pending' }
  };
  patch.validation = input.parseFailed
    ? {
        ok: false,
        riskLevel: 'blocked',
        status: 'blocked',
        errors: [{
          code: 'OUTPUT_PARSE_FAILED',
          severity: 'blocking',
          message: 'Model output could not be parsed as the required WritingPatch JSON proposal.',
          target: { sectionId: applyPayload.sectionId }
        }],
        warnings: [],
        checks: [{
          checkKind: 'custom',
          passed: false,
          severity: 'blocking',
          message: 'Model output parse failed.'
        }],
        validatedAt: timestamp
      }
    : validateWritingPatch(patch, section);
  const diffInput = beforeAfterForPatch(patch);
  patch.diff = createPatchDiff(diffInput.before, diffInput.after);
  patch.status = input.parseFailed
    ? 'parse_failed'
    : patch.validation.ok
      ? 'needs_review'
      : 'blocked';
  patch.metadata.riskLevel = patch.validation.riskLevel;
  return patch;
}

function writingPatchKindForApplyPayload(payload: GenerationApplyPayload): WritingPatch['kind'] {
  if (payload.mode === 'rewrite_section') {
    return 'replace_section';
  }
  if (payload.mode === 'rewrite_selection') {
    return 'replace_selection';
  }
  return 'insert_at_cursor';
}

export function parseGenerationApplyPayload(raw: string | null): GenerationApplyPayload {
  if (!raw) {
    throw new Error('Generation task is missing adoption metadata.');
  }
  const parsed = JSON.parse(raw) as GenerationApplyPayload;
  if (!parsed || parsed.kind !== 'edit') {
    throw new Error('Generation task adoption metadata is invalid.');
  }
  return parsed;
}

function generationModeLabel(mode: GenerationMode): string {
  switch (mode) {
    case 'append':
      return 'Append';
    case 'rewrite_section':
      return 'Rewrite';
    case 'rewrite_selection':
      return 'Selection';
    case 'continue':
      return 'Continue';
  }
}

function selectedTextForLlmEdit(
  mode: SectionLlmEditMode,
  markdown: string,
  targetStart: number,
  targetEnd: number
): string {
  if (mode === 'rewrite_section') {
    return markdown;
  }
  if (mode === 'continue_at_cursor') {
    return '';
  }
  return markdown.slice(targetStart, targetEnd);
}
