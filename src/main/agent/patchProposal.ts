import type {
  PatchValidationResult,
  SectionNodeRecord,
  WritingPatch,
  WritingPatchRecord
} from '../../shared/types.js';
import { createId, nowIso } from '../ids.js';
import { createPatchDiff } from '../harness/patchDiff.js';
import { hashText, scanCitations } from '../harness/patchScanners.js';
import { beforeAfterForPatch, validateWritingPatch } from '../harness/patchValidator.js';
import type {
  PatchProposalRequest,
  PatchProposalResult
} from './writeLlmTools.js';

export type PiPatchDatabase = {
  workspacePath: string;
  getSection(sectionId: string): SectionNodeRecord | null;
  createWritingPatch(patch: WritingPatch): WritingPatchRecord;
};

/**
 * Converts an allowlisted Pi proposal into the existing WritingPatch review
 * artifact. It performs no document update, checkpoint, or acceptance action.
 */
export async function createPiPatchProposal(
  db: PiPatchDatabase,
  request: PatchProposalRequest,
  signal: AbortSignal
): Promise<PatchProposalResult> {
  if (signal.aborted) {
    throw new Error('The Pi run was canceled before the patch proposal could be created.');
  }
  const section = db.getSection(request.sectionId);
  if (!section) {
    throw new Error('The active writing section is no longer available.');
  }
  const patch = buildPiWritingPatch(db.workspacePath, section, request);
  db.createWritingPatch(patch);
  return {
    proposalId: patch.id,
    summary: patch.validation?.ok
      ? 'Created a reviewable patch. Author approval is still required before any document change.'
      : 'Created a blocked patch for review; fix the listed validation issues before applying it.',
    warnings: [
      ...(patch.validation?.warnings.map((issue) => issue.message) ?? []),
      ...(patch.validation?.errors.map((issue) => issue.message) ?? [])
    ].slice(0, 8)
  };
}

export function buildPiWritingPatch(
  workspacePath: string,
  section: SectionNodeRecord,
  request: PatchProposalRequest
): WritingPatch {
  const timestamp = nowIso();
  const replacement = request.replacementMarkdown.trim();
  if (!replacement) {
    throw new Error('A patch proposal must include replacement Markdown.');
  }
  const selection = request.selection;
  const target = patchTargetForRequest(request, section);
  const before = target.kind === 'replace_section'
    ? section.markdownContent
    : target.kind === 'replace_selection'
      ? section.markdownContent.slice(target.start, target.end)
      : '';
  const patch: WritingPatch = {
    id: createId('wpatch'),
    kind: target.kind === 'append_to_section' ? 'insert_at_cursor' : target.kind,
    status: 'proposed',
    origin: {
      source: 'llm',
      actionId: request.runId,
      createdAt: timestamp
    },
    target: {
      workspaceId: workspacePath,
      sectionId: section.id,
      targetMode: 'section_markdown_file',
      location: target.kind === 'replace_section'
        ? { type: 'section', sectionHash: section.markdownHash }
        : target.kind === 'replace_selection'
          ? {
              type: 'text_range',
              startOffset: target.start,
              endOffset: target.end,
              selectedText: before
            }
          : {
              type: 'insertion',
              mode: target.kind === 'append_to_section' ? 'section_end' : 'cursor',
              offset: target.kind === 'append_to_section' ? section.markdownContent.length : target.offset,
              insertionAffinity: 'after'
            }
    },
    anchors: {
      baseSectionHash: section.markdownHash,
      beforeText: before,
      beforeTextHash: before ? hashText(before) : undefined,
      prefixContext: target.kind === 'replace_selection'
        ? boundedContext(section.markdownContent.slice(Math.max(0, target.start - 300), target.start))
        : undefined,
      suffixContext: target.kind === 'replace_selection'
        ? boundedContext(section.markdownContent.slice(target.end, target.end + 300))
        : undefined,
      anchorStrategy: target.kind === 'replace_section'
        ? 'section_replace'
        : 'hash_and_range'
    },
    operation: target.kind === 'replace_section' || target.kind === 'replace_selection'
      ? { type: 'replace', before, after: replacement }
      : { type: 'insert', text: replacement, position: 'at' },
    metadata: {
      title: 'Pi writing proposal',
      actionType: target.kind === 'replace_section' || target.kind === 'replace_selection' ? 'revise' : 'draft',
      rationale: request.rationale,
      warnings: [],
      provenance: {
        piRunId: request.runId,
        retrievedChunkIds: unique(request.evidenceManifest.map((entry) => entry.chunkId)),
        evidencePublicRefs: unique(request.evidenceManifest.map((entry) => entry.publicRef)),
        citationMarkers: scanCitations(replacement)
      }
    },
    review: { decision: 'pending' }
  };
  const validation = validateWritingPatch(patch, section);
  patch.validation = addEvidenceValidation(validation, patch, request);
  const diff = beforeAfterForPatch(patch);
  patch.diff = createPatchDiff(diff.before, diff.after);
  patch.status = patch.validation.ok ? 'needs_review' : 'blocked';
  patch.metadata.riskLevel = patch.validation.riskLevel;
  patch.metadata.warnings = patch.validation.warnings.map((issue) => issue.message);
  return patch;
}

function patchTargetForRequest(
  request: PatchProposalRequest,
  section: SectionNodeRecord
):
  | { kind: 'replace_section' }
  | { kind: 'replace_selection'; start: number; end: number }
  | { kind: 'insert_at_cursor'; offset: number }
  | { kind: 'append_to_section' } {
  if (request.patchTarget === 'replace_section') {
    return { kind: 'replace_section' };
  }
  if (request.patchTarget === 'append_to_section') {
    return { kind: 'append_to_section' };
  }
  const selection = request.selection;
  if (!selection || !Number.isInteger(selection.start) || !Number.isInteger(selection.end) || selection.start < 0 || selection.end < selection.start || selection.end > section.markdownContent.length) {
    throw new Error('The proposal target range is no longer valid for this section.');
  }
  if (request.patchTarget === 'replace_selection') {
    if (selection.start === selection.end) {
      throw new Error('A selection replacement requires non-empty selected text.');
    }
    return { kind: 'replace_selection', start: selection.start, end: selection.end };
  }
  return { kind: 'insert_at_cursor', offset: selection.start };
}

function addEvidenceValidation(
  validation: PatchValidationResult,
  patch: WritingPatch,
  request: PatchProposalRequest
): PatchValidationResult {
  const before = beforeAfterForPatch(patch).before;
  const existingCitations = new Set(scanCitations(before).map((citation) => citation.toLowerCase()));
  const retrievedCitations = new Set(request.evidenceManifest.map((entry) => entry.publicRef.toLowerCase()));
  const unresolved = scanCitations(beforeAfterForPatch(patch).after)
    .filter((citation) => !existingCitations.has(citation.toLowerCase()))
    .filter((citation) => !retrievedCitations.has(citation.toLowerCase()));
  if (unresolved.length === 0) {
    return validation;
  }
  const message = `New citations were not retrieved during this Pi run: ${unique(unresolved).join(', ')}.`;
  return {
    ...validation,
    ok: false,
    status: 'blocked',
    riskLevel: 'blocked',
    errors: [
      ...validation.errors,
      {
        code: 'UNRESOLVED_CITATION',
        severity: 'blocking',
        message,
        target: { sectionId: patch.target.sectionId }
      }
    ],
    checks: [
      ...validation.checks,
      {
        checkKind: 'citation',
        passed: false,
        severity: 'blocking',
        message
      }
    ]
  };
}

function boundedContext(value: string): string {
  return value.length > 300 ? value.slice(-300) : value;
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
