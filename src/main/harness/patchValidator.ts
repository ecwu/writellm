import type {
  PatchCheckResult,
  PatchRiskLevel,
  PatchValidationCode,
  PatchValidationIssue,
  PatchValidationResult,
  SectionNodeRecord,
  WritingPatch
} from '../../shared/types.js';
import { nowIso } from '../ids.js';
import { scanCitations, scanNumbers } from './patchScanners.js';

export function validateWritingPatch(
  patch: WritingPatch,
  currentSection: SectionNodeRecord | null
): PatchValidationResult {
  const errors: PatchValidationIssue[] = [];
  const warnings: PatchValidationIssue[] = [];
  const checks: PatchCheckResult[] = [];

  const fail = (code: PatchValidationCode, message: string, severity: PatchValidationIssue['severity'] = 'blocking') => {
    const issue = issueFor(code, severity, message, patch.target.sectionId);
    if (severity === 'warning' || severity === 'info') {
      warnings.push(issue);
    } else {
      errors.push(issue);
    }
    checks.push({ checkKind: checkKindForCode(code), passed: false, severity, message });
  };

  if (!currentSection) {
    fail('TARGET_SECTION_NOT_FOUND', `Section not found: ${patch.target.sectionId}`);
    return result(errors, warnings, checks);
  }

  const currentMarkdown = currentSection.markdownContent;
  const directMutation = patch.kind === 'replace_selection' || patch.kind === 'insert_at_cursor' || patch.kind === 'replace_section';
  if (directMutation && currentSection.markdownHash !== patch.anchors.baseSectionHash) {
    fail('BASE_SECTION_HASH_MISMATCH', 'The section changed after this patch was generated.');
  } else {
    checks.push({ checkKind: 'anchor', passed: true, severity: 'info', message: 'Base section hash matches.' });
  }

  if (patch.kind === 'replace_section') {
    fail('UNSUPPORTED_PATCH_KIND', 'Direct whole-section replacement is not supported in the WritingPatch MVP.');
  }

  const beforeAfter = beforeAfterForPatch(patch);
  if (patch.kind === 'replace_selection') {
    if (patch.target.location.type !== 'text_range') {
      fail('RANGE_OUT_OF_BOUNDS', 'Selection replacement patch is missing a text range.');
    } else {
      const { startOffset, endOffset, selectedText } = patch.target.location;
      if (startOffset < 0 || endOffset > currentMarkdown.length || startOffset >= endOffset) {
        fail('RANGE_OUT_OF_BOUNDS', 'Selection range is outside the current section.');
      } else if (currentMarkdown.slice(startOffset, endOffset) !== selectedText || selectedText !== beforeAfter.before) {
        fail('SELECTED_TEXT_MISMATCH', 'The selected text no longer matches the patch anchor.');
      } else {
        checks.push({ checkKind: 'anchor', passed: true, severity: 'info', message: 'Selected text still matches.' });
      }
    }
  }

  if (patch.kind === 'insert_at_cursor') {
    if (patch.target.location.type !== 'insertion' || patch.target.location.offset < 0 || patch.target.location.offset > currentMarkdown.length) {
      fail('RANGE_OUT_OF_BOUNDS', 'Insertion offset is outside the current section.');
    }
  }

  if (!beforeAfter.after.trim()) {
    fail('EMPTY_AFTER_TEXT', 'Generated patch text is empty.');
  }

  addLengthIssues(patch, beforeAfter.before, beforeAfter.after, fail);
  addCitationIssues(patch, beforeAfter.before, beforeAfter.after, fail);
  addNumberIssues(patch, beforeAfter.before, beforeAfter.after, fail);
  addMarkdownIssues(beforeAfter.after, fail);
  addLatexIssues(beforeAfter.after, fail);
  addClaimRiskIssues(beforeAfter.before, beforeAfter.after, fail);

  return result(errors, warnings, checks);
}

export function beforeAfterForPatch(patch: WritingPatch): { before: string; after: string } {
  if (patch.operation.type === 'replace') {
    return { before: patch.operation.before, after: patch.operation.after };
  }
  if (patch.operation.type === 'insert') {
    return { before: '', after: patch.operation.text };
  }
  return { before: '', after: patch.operation.content };
}

function addLengthIssues(
  patch: WritingPatch,
  before: string,
  after: string,
  fail: (code: PatchValidationCode, message: string, severity?: PatchValidationIssue['severity']) => void
): void {
  if (!before.trim()) {
    return;
  }
  const actionType = patch.metadata.actionType;
  if (after.length < before.length * 0.2 && actionType !== 'compress') {
    fail('SUSPICIOUSLY_SHORT_OUTPUT', 'Generated text is much shorter than the text it replaces.', 'warning');
  }
  if (after.length > before.length * 2.5 && actionType !== 'expand' && actionType !== 'draft') {
    fail('SUSPICIOUSLY_LONG_OUTPUT', 'Generated text is much longer than the text it replaces.', 'warning');
  }
}

function addCitationIssues(
  patch: WritingPatch,
  before: string,
  after: string,
  fail: (code: PatchValidationCode, message: string, severity?: PatchValidationIssue['severity']) => void
): void {
  if (patch.kind !== 'replace_selection') {
    return;
  }
  const afterCitations = new Set(scanCitations(after));
  for (const citation of scanCitations(before)) {
    if (!afterCitations.has(citation)) {
      fail('CITATION_REMOVED', `Citation removed or modified: ${citation}`, 'warning');
    }
  }
}

function addNumberIssues(
  patch: WritingPatch,
  before: string,
  after: string,
  fail: (code: PatchValidationCode, message: string, severity?: PatchValidationIssue['severity']) => void
): void {
  if (patch.kind !== 'replace_selection') {
    return;
  }
  const afterNumbers = new Set(scanNumbers(after));
  for (const number of scanNumbers(before)) {
    if (!afterNumbers.has(number)) {
      fail('NUMBER_CHANGED', `Numeric value changed or removed: ${number}`, 'warning');
    }
  }
}

function addMarkdownIssues(
  after: string,
  fail: (code: PatchValidationCode, message: string, severity?: PatchValidationIssue['severity']) => void
): void {
  const fences = after.match(/^ {0,3}(```+|~~~+)/gm) ?? [];
  if (fences.length % 2 !== 0) {
    fail('MARKDOWN_BROKEN', 'Generated text has an unclosed code fence.', 'warning');
  }
  if (/\[[^\]\n]+\]\([^)\n]*$/.test(after) || /!\[[^\]\n]*\]\([^)\n]*$/.test(after)) {
    fail('MARKDOWN_BROKEN', 'Generated text appears to contain a broken Markdown link or image.', 'warning');
  }
}

function addLatexIssues(
  after: string,
  fail: (code: PatchValidationCode, message: string, severity?: PatchValidationIssue['severity']) => void
): void {
  if (braceBalance(after) !== 0 || /\\(?:cite|citet|citep|ref)\{[^}\n]*$/.test(after)) {
    fail('LATEX_BROKEN', 'Generated text appears to contain unbalanced LaTeX braces or references.', 'warning');
  }
  if ((after.match(/\$/g) ?? []).length % 2 !== 0) {
    fail('LATEX_BROKEN', 'Generated text appears to contain unbalanced inline math delimiters.', 'warning');
  }
}

function addClaimRiskIssues(
  before: string,
  after: string,
  fail: (code: PatchValidationCode, message: string, severity?: PatchValidationIssue['severity']) => void
): void {
  const risky = ['prove', 'guarantee', 'always', 'significantly improves', 'state-of-the-art', 'fully solves', 'generalizes to'];
  const beforeLower = before.toLowerCase();
  const afterLower = after.toLowerCase();
  for (const phrase of risky) {
    if (!beforeLower.includes(phrase) && afterLower.includes(phrase)) {
      fail('CLAIM_STRENGTH_INCREASED', `Potential claim-strength increase introduced: ${phrase}`, 'warning');
    }
  }
}

function result(
  errors: PatchValidationIssue[],
  warnings: PatchValidationIssue[],
  checks: PatchCheckResult[]
): PatchValidationResult {
  const blocked = errors.some((issue) => issue.severity === 'blocking' || issue.severity === 'error');
  const riskLevel: PatchRiskLevel = blocked ? 'blocked' : warnings.length > 0 ? 'medium' : 'low';
  return {
    ok: !blocked,
    riskLevel,
    status: blocked ? 'blocked' : warnings.length > 0 ? 'valid_with_warnings' : 'valid',
    errors,
    warnings,
    checks,
    validatedAt: nowIso()
  };
}

function issueFor(
  code: PatchValidationCode,
  severity: PatchValidationIssue['severity'],
  message: string,
  sectionId: string
): PatchValidationIssue {
  return { code, severity, message, target: { sectionId } };
}

function checkKindForCode(code: PatchValidationCode): PatchCheckResult['checkKind'] {
  if (code.includes('CITATION')) return 'citation';
  if (code.includes('NUMBER')) return 'number';
  if (code.includes('MARKDOWN')) return 'markdown';
  if (code.includes('LATEX')) return 'latex';
  if (code.includes('CLAIM')) return 'claim';
  if (code.includes('HASH') || code.includes('RANGE') || code.includes('TEXT')) return 'anchor';
  if (code.includes('SHORT') || code.includes('LONG') || code.includes('EMPTY')) return 'length';
  return 'custom';
}

function braceBalance(text: string): number {
  let balance = 0;
  for (const char of text) {
    if (char === '{') balance += 1;
    if (char === '}') balance -= 1;
  }
  return balance;
}

