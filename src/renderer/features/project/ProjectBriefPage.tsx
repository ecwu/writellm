import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Check,
  FileText,
  Lightbulb,
  Plus,
  Route,
  Save,
  Sparkles,
  Trash2,
  X
} from 'lucide-react';
import { getApi } from '../../api';
import { Button } from '../../components/ui/button';
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel
} from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import { ScrollArea } from '../../components/ui/scroll-area';
import { Textarea } from '../../components/ui/textarea';
import type {
  CompositionTreeNode,
  FocusedWorkspaceState,
  ProjectBriefRecord,
  ProjectBriefSuggestion,
  ProjectBriefSuggestionTarget,
  ProjectFramework,
  ProjectFrameworkSection,
  ProjectGlossary,
  ProjectGlossaryTerm,
  ProjectMotivation
} from '../../../shared/types';

type SuggestionState = {
  target: ProjectBriefSuggestionTarget;
  suggestion: ProjectBriefSuggestion;
};

export function ProjectBriefPage({
  brief,
  focusSectionId,
  compositionTree,
  knowledgeCount,
  onState,
  onStatus,
  onError
}: {
  brief: ProjectBriefRecord;
  focusSectionId: string | null;
  compositionTree: CompositionTreeNode[];
  knowledgeCount: number;
  onState: (state: FocusedWorkspaceState) => void;
  onStatus: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [draft, setDraft] = useState<ProjectBriefRecord>(() => cloneBrief(brief));
  const [suggestion, setSuggestion] = useState<SuggestionState | null>(null);
  const [suggestingTarget, setSuggestingTarget] = useState<ProjectBriefSuggestionTarget | null>(null);
  const [saving, setSaving] = useState(false);
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(brief), [brief, draft]);

  useEffect(() => {
    setDraft(cloneBrief(brief));
    setSuggestion(null);
  }, [brief]);

  async function save() {
    setSaving(true);
    try {
      const next = await getApi().updateProjectBrief({
        glossary: draft.glossary,
        motivation: draft.motivation,
        framework: draft.framework,
        focusSectionId
      });
      onState(next);
      onStatus('Project brief saved.');
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  }

  async function suggest(target: ProjectBriefSuggestionTarget) {
    setSuggestingTarget(target);
    setSuggestion(null);
    try {
      const next = await getApi().suggestProjectBrief({
        target,
        currentBrief: draft
      });
      setSuggestion({ target, suggestion: next });
      onStatus('Project brief suggestion ready.');
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSuggestingTarget(null);
    }
  }

  function applySuggestion(nextSuggestion: ProjectBriefSuggestion) {
    setDraft((current) => ({
      ...current,
      glossary: nextSuggestion.glossary
        ? mergeGlossary(current.glossary, nextSuggestion.glossary)
        : current.glossary,
      motivation: nextSuggestion.motivation ?? current.motivation,
      framework: nextSuggestion.framework ?? current.framework
    }));
    setSuggestion(null);
  }

  function reset() {
    setDraft(cloneBrief(brief));
    setSuggestion(null);
  }

  return (
    <main className="project-brief-page">
      <aside className="project-brief-sidebar">
        <div className="project-brief-header">
          <div>
            <h1>Project Brief</h1>
            <p>{knowledgeCount} source{knowledgeCount === 1 ? '' : 's'} available</p>
          </div>
        </div>
        <div className="project-brief-actions">
          <Button size="sm" onClick={() => void save()} disabled={!dirty || saving}>
            <Save />
            {saving ? 'Saving' : 'Save'}
          </Button>
          <Button variant="outline" size="sm" onClick={reset} disabled={!dirty && !suggestion}>
            <X />
            Reset
          </Button>
        </div>
        <div className="project-brief-assist">
          <p>Assist</p>
          <Button variant="outline" size="sm" onClick={() => void suggest('all')} disabled={Boolean(suggestingTarget)}>
            <Sparkles />
            {suggestingTarget === 'all' ? 'Drafting' : 'Draft all'}
          </Button>
          <Button variant="outline" size="sm" onClick={() => void suggest('glossary')} disabled={Boolean(suggestingTarget)}>
            <FileText />
            Glossary
          </Button>
          <Button variant="outline" size="sm" onClick={() => void suggest('motivation')} disabled={Boolean(suggestingTarget)}>
            <Lightbulb />
            Motivation
          </Button>
          <Button variant="outline" size="sm" onClick={() => void suggest('framework')} disabled={Boolean(suggestingTarget)}>
            <Route />
            Framework
          </Button>
        </div>
        {suggestion ? (
          <SuggestionPreview
            state={suggestion}
            onApply={() => applySuggestion(suggestion.suggestion)}
            onDismiss={() => setSuggestion(null)}
          />
        ) : (
          <p className="project-brief-sidebar-note">
            Suggestions are previews. Apply them to the form, review the fields, then save.
          </p>
        )}
      </aside>

      <ScrollArea className="project-brief-scroll">
        <div className="project-brief-editor">
          <GlossaryEditor
            glossary={draft.glossary}
            onChange={(glossary) => setDraft((current) => ({ ...current, glossary }))}
          />
          <MotivationEditor
            motivation={draft.motivation}
            onChange={(motivation) => setDraft((current) => ({ ...current, motivation }))}
          />
          <FrameworkEditor
            framework={draft.framework}
            compositionTree={compositionTree}
            onChange={(framework) => setDraft((current) => ({ ...current, framework }))}
          />
        </div>
      </ScrollArea>
    </main>
  );
}

function GlossaryEditor({
  glossary,
  onChange
}: {
  glossary: ProjectGlossary;
  onChange: (glossary: ProjectGlossary) => void;
}) {
  function updateEntry(id: string, patch: Partial<ProjectGlossaryTerm>) {
    onChange({
      ...glossary,
      entries: glossary.entries.map((entry) => entry.id === id ? { ...entry, ...patch } : entry)
    });
  }

  function removeEntry(id: string) {
    onChange({ ...glossary, entries: glossary.entries.filter((entry) => entry.id !== id) });
  }

  return (
    <section className="project-brief-section">
      <SectionHeading
        icon={<FileText />}
        title="Glossary"
        detail={`${glossary.entries.length} term${glossary.entries.length === 1 ? '' : 's'}`}
        action={
          <Button size="sm" variant="outline" onClick={() => onChange({ ...glossary, entries: [...glossary.entries, emptyTerm()] })}>
            <Plus />
            Term
          </Button>
        }
      />
      <div className="project-glossary-list">
        {glossary.entries.map((entry, index) => (
          <div key={entry.id} className="project-glossary-row">
            <div className="project-row-heading">
              <span>Term {index + 1}</span>
              <Button variant="ghost" size="icon" title="Remove term" aria-label="Remove term" onClick={() => removeEntry(entry.id)}>
                <Trash2 />
              </Button>
            </div>
            <FieldGroup className="project-brief-grid">
              <Field>
                <FieldLabel>Canonical term</FieldLabel>
                <Input value={entry.term} onChange={(event) => updateEntry(entry.id, { term: event.target.value })} />
              </Field>
              <Field>
                <FieldLabel>Aliases</FieldLabel>
                <Input
                  value={entry.aliases.join(', ')}
                  onChange={(event) => updateEntry(entry.id, { aliases: splitList(event.target.value) })}
                  placeholder="Comma-separated variants"
                />
              </Field>
              <Field className="project-brief-grid-wide">
                <FieldLabel>Definition</FieldLabel>
                <Textarea value={entry.definition} onChange={(event) => updateEntry(entry.id, { definition: event.target.value })} />
              </Field>
              <Field>
                <FieldLabel>Preferred usage</FieldLabel>
                <Textarea value={entry.preferredUsage} onChange={(event) => updateEntry(entry.id, { preferredUsage: event.target.value })} />
              </Field>
              <Field>
                <FieldLabel>Avoid usage</FieldLabel>
                <Textarea value={entry.avoidUsage} onChange={(event) => updateEntry(entry.id, { avoidUsage: event.target.value })} />
              </Field>
              <Field className="project-brief-grid-wide">
                <FieldLabel>Examples</FieldLabel>
                <Textarea
                  value={entry.examples.join('\n')}
                  onChange={(event) => updateEntry(entry.id, { examples: splitList(event.target.value) })}
                  placeholder="One example per line"
                />
              </Field>
            </FieldGroup>
          </div>
        ))}
      </div>
      <Field>
        <FieldLabel>Glossary notes</FieldLabel>
        <Textarea value={glossary.notes} onChange={(event) => onChange({ ...glossary, notes: event.target.value })} />
      </Field>
    </section>
  );
}

function MotivationEditor({
  motivation,
  onChange
}: {
  motivation: ProjectMotivation;
  onChange: (motivation: ProjectMotivation) => void;
}) {
  return (
    <section className="project-brief-section">
      <SectionHeading icon={<Lightbulb />} title="Motivation" detail="Audience, problem, thesis, and constraints" />
      <FieldGroup className="project-brief-grid">
        {motivationFields.map((field) => (
          <Field key={field.key} className={field.long ? 'project-brief-grid-wide' : undefined}>
            <FieldLabel>{field.label}</FieldLabel>
            <Textarea
              value={motivation[field.key]}
              onChange={(event) => onChange({ ...motivation, [field.key]: event.target.value })}
            />
            {field.description ? <FieldDescription>{field.description}</FieldDescription> : null}
          </Field>
        ))}
      </FieldGroup>
    </section>
  );
}

function FrameworkEditor({
  framework,
  compositionTree,
  onChange
}: {
  framework: ProjectFramework;
  compositionTree: CompositionTreeNode[];
  onChange: (framework: ProjectFramework) => void;
}) {
  function updateSection(id: string, patch: Partial<ProjectFrameworkSection>) {
    onChange({
      ...framework,
      sectionPlan: framework.sectionPlan.map((section) => section.id === id ? { ...section, ...patch } : section)
    });
  }

  function initializeFromOutline() {
    const sections = flattenSections(compositionTree).map((section) => ({
      id: section.id,
      title: section.title,
      purpose: section.intent ?? '',
      keyMoves: '',
      evidence: ''
    }));
    onChange({ ...framework, sectionPlan: sections });
  }

  return (
    <section className="project-brief-section">
      <SectionHeading
        icon={<Route />}
        title="Framework"
        detail={`${framework.sectionPlan.length} planned section${framework.sectionPlan.length === 1 ? '' : 's'}`}
        action={
          <div className="button-row">
            <Button variant="outline" size="sm" onClick={initializeFromOutline}>
              <FileText />
              From outline
            </Button>
            <Button size="sm" variant="outline" onClick={() => onChange({ ...framework, sectionPlan: [...framework.sectionPlan, emptyFrameworkSection()] })}>
              <Plus />
              Section
            </Button>
          </div>
        }
      />
      <Field>
        <FieldLabel>Narrative arc</FieldLabel>
        <Textarea value={framework.narrativeArc} onChange={(event) => onChange({ ...framework, narrativeArc: event.target.value })} />
      </Field>
      <div className="project-framework-list">
        {framework.sectionPlan.map((section, index) => (
          <div key={section.id} className="project-framework-row">
            <div className="project-row-heading">
              <span>Section {index + 1}</span>
              <Button
                variant="ghost"
                size="icon"
                title="Remove section plan"
                aria-label="Remove section plan"
                onClick={() => onChange({ ...framework, sectionPlan: framework.sectionPlan.filter((item) => item.id !== section.id) })}
              >
                <Trash2 />
              </Button>
            </div>
            <FieldGroup className="project-brief-grid">
              <Field>
                <FieldLabel>Title</FieldLabel>
                <Input value={section.title} onChange={(event) => updateSection(section.id, { title: event.target.value })} />
              </Field>
              <Field>
                <FieldLabel>Purpose</FieldLabel>
                <Textarea value={section.purpose} onChange={(event) => updateSection(section.id, { purpose: event.target.value })} />
              </Field>
              <Field>
                <FieldLabel>Key moves</FieldLabel>
                <Textarea value={section.keyMoves} onChange={(event) => updateSection(section.id, { keyMoves: event.target.value })} />
              </Field>
              <Field>
                <FieldLabel>Evidence</FieldLabel>
                <Textarea value={section.evidence} onChange={(event) => updateSection(section.id, { evidence: event.target.value })} />
              </Field>
            </FieldGroup>
          </div>
        ))}
      </div>
      <Field>
        <FieldLabel>Framework notes</FieldLabel>
        <Textarea value={framework.notes} onChange={(event) => onChange({ ...framework, notes: event.target.value })} />
      </Field>
    </section>
  );
}

function SuggestionPreview({
  state,
  onApply,
  onDismiss
}: {
  state: SuggestionState;
  onApply: () => void;
  onDismiss: () => void;
}) {
  return (
    <section className="project-brief-suggestion">
      <div className="project-suggestion-heading">
        <span>{state.target} suggestion</span>
        <div className="button-row">
          <Button size="sm" onClick={onApply}>
            <Check />
            Apply
          </Button>
          <Button variant="ghost" size="icon" title="Dismiss suggestion" aria-label="Dismiss suggestion" onClick={onDismiss}>
            <X />
          </Button>
        </div>
      </div>
      <p>{state.suggestion.rationale}</p>
      <pre>{JSON.stringify(previewSuggestion(state.suggestion), null, 2)}</pre>
    </section>
  );
}

function SectionHeading({
  icon,
  title,
  detail,
  action
}: {
  icon: ReactNode;
  title: string;
  detail: string;
  action?: ReactNode;
}) {
  return (
    <div className="project-section-heading">
      <span className="project-section-icon">{icon}</span>
      <div>
        <h2>{title}</h2>
        <p>{detail}</p>
      </div>
      {action ? <div className="project-section-action">{action}</div> : null}
    </div>
  );
}

const motivationFields: Array<{
  key: keyof ProjectMotivation;
  label: string;
  long?: boolean;
  description?: string;
}> = [
  { key: 'audience', label: 'Audience' },
  { key: 'problem', label: 'Problem', long: true },
  { key: 'thesis', label: 'Thesis', long: true },
  { key: 'contribution', label: 'Contribution', long: true },
  { key: 'desiredReaderAction', label: 'Desired reader action' },
  { key: 'constraints', label: 'Constraints' },
  { key: 'notes', label: 'Notes', long: true }
];

function cloneBrief(brief: ProjectBriefRecord): ProjectBriefRecord {
  return JSON.parse(JSON.stringify(brief)) as ProjectBriefRecord;
}

function emptyTerm(): ProjectGlossaryTerm {
  return {
    id: `term-${crypto.randomUUID()}`,
    term: '',
    aliases: [],
    definition: '',
    preferredUsage: '',
    avoidUsage: '',
    examples: []
  };
}

function emptyFrameworkSection(): ProjectFrameworkSection {
  return {
    id: `briefsec-${crypto.randomUUID()}`,
    title: '',
    purpose: '',
    keyMoves: '',
    evidence: ''
  };
}

function splitList(value: string): string[] {
  return value
    .split(/[\n,;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function mergeGlossary(current: ProjectGlossary, suggestion: ProjectGlossary): ProjectGlossary {
  const existingTerms = new Set(current.entries.map((entry) => normalizeTermKey(entry.term)));
  const merged = suggestion.entries.filter((entry) => {
    const key = normalizeTermKey(entry.term);
    return key && !existingTerms.has(key);
  });
  return {
    entries: [...current.entries, ...merged],
    notes: current.notes || suggestion.notes
  };
}

function normalizeTermKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function flattenSections(nodes: CompositionTreeNode[]): CompositionTreeNode[] {
  return nodes.flatMap((node) => [node, ...flattenSections(node.children)]);
}

function previewSuggestion(suggestion: ProjectBriefSuggestion) {
  return {
    glossary: suggestion.glossary,
    motivation: suggestion.motivation,
    framework: suggestion.framework
  };
}
