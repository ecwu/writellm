import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Bug,
  Cpu,
  Database,
  Eye,
  FileText,
  KeyRound,
  MessageSquareText,
  MonitorCog,
  Moon,
  Palette,
  Save,
  Settings2,
  SlidersHorizontal,
  Sun
} from 'lucide-react';
import { getApi } from '../../api';
import { Button } from '../../components/ui/button';
import { Checkbox } from '../../components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle
} from '../../components/ui/dialog';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet
} from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../../components/ui/select';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider
} from '../../components/ui/sidebar';
import { Switch } from '../../components/ui/switch';
import type {
  AccentColor,
  AppearanceSettings,
  AppFontFamily,
  KnowledgeRetrievalSettings,
  LlmProviderKind,
  MineruModelVersion,
  PdfExtractionEngine,
  PublicLlmSettings,
  RerankProviderKind,
  ThemeMode
} from '../../../shared/types';

type SettingsSectionId = 'general' | 'appearance' | 'knowledge' | 'chat' | 'embedding' | 'rerank' | 'vision';
type ModelEndpointSectionId = 'chat' | 'embedding' | 'vision';

type EndpointDraft = {
  provider: LlmProviderKind;
  baseURL: string;
  model: string;
  apiKey: string;
};

type RerankEndpointDraft = {
  provider: RerankProviderKind;
  baseURL: string;
  model: string;
  apiKey: string;
  enabled: boolean;
};

type KnowledgeDraft = {
  pdfExtractionEngine: PdfExtractionEngine;
  mineruApiKey: string;
  mineruModelVersion: MineruModelVersion;
  mineruLanguage: string;
  mineruIsOcr: boolean;
  mineruEnableTable: boolean;
  mineruEnableFormula: boolean;
  retrieval: KnowledgeRetrievalSettings;
};

const defaultAppearance: AppearanceSettings = {
  theme: 'system',
  accentColor: 'deep-teal',
  fontFamily: 'geist'
};

const defaultKnowledgeRetrieval: KnowledgeRetrievalSettings = {
  maxRetrievedChunks: 10,
  maxCandidateChunks: 40,
  rerankTopN: 30,
  adjacentChunkRadius: 1,
  maxChunksPerItem: 3,
  chunkTargetChars: 700,
  chunkOverlapChars: 100,
  embeddingBatchSize: 64
};

const providerOptions: { value: LlmProviderKind; label: string }[] = [
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'openai-compatible', label: 'OpenAI compatible' },
  { value: 'anthropic-compatible', label: 'Anthropic compatible' }
];

const accentOptions: {
  value: AccentColor;
  label: string;
  swatch: string;
}[] = [
  { value: 'earth', label: 'Pale earth', swatch: 'oklch(0.42 0.045 75)' },
  { value: 'forest', label: 'Deep green', swatch: 'oklch(0.34 0.07 148)' },
  { value: 'ochre', label: 'Ochre', swatch: 'oklch(0.72 0.085 82)' },
  { value: 'cinnabar', label: 'Cinnabar', swatch: 'oklch(0.48 0.145 32)' },
  { value: 'deep-teal', label: 'Deep teal', swatch: 'oklch(0.32 0.06 205)' },
  { value: 'plum', label: 'Deep plum', swatch: 'oklch(0.36 0.08 315)' }
];

const themeOptions: {
  value: ThemeMode;
  label: string;
  icon: ReactNode;
}[] = [
  { value: 'system', label: 'Auto', icon: <MonitorCog /> },
  { value: 'light', label: 'Light', icon: <Sun /> },
  { value: 'dark', label: 'Dark', icon: <Moon /> }
];

const fontOptions: {
  value: AppFontFamily;
  label: string;
  previewFont: string;
}[] = [
  { value: 'geist', label: 'Geist', previewFont: '"Geist Variable", sans-serif' },
  {
    value: 'system-sans',
    label: 'System Sans',
    previewFont: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
  },
  {
    value: 'humanist-sans',
    label: 'Humanist Sans',
    previewFont: 'Avenir, "Avenir Next", "Segoe UI", Frutiger, "Gill Sans", "Trebuchet MS", sans-serif'
  },
  { value: 'serif', label: 'Serif', previewFont: 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif' },
  {
    value: 'mono',
    label: 'Monospace',
    previewFont: 'ui-monospace, "SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono", monospace'
  }
];

const navGroups: {
  label: string;
  items: {
    id: SettingsSectionId;
    label: string;
    icon: ReactNode;
  }[];
}[] = [
  {
    label: 'Global',
    items: [
      { id: 'general', label: 'General', icon: <Settings2 /> },
      { id: 'appearance', label: 'Appearance', icon: <Palette /> },
      { id: 'knowledge', label: 'Knowledge', icon: <FileText /> }
    ]
  },
  {
    label: 'Models',
    items: [
      { id: 'chat', label: 'Chat', icon: <MessageSquareText /> },
      { id: 'embedding', label: 'Embeddings', icon: <Database /> },
      { id: 'rerank', label: 'Rerank', icon: <SlidersHorizontal /> },
      { id: 'vision', label: 'Vision', icon: <Eye /> }
    ]
  }
];

const sectionTitles: Record<SettingsSectionId, string> = {
  general: 'General',
  appearance: 'Appearance',
  knowledge: 'Knowledge',
  chat: 'Chat model',
  embedding: 'Embedding model',
  rerank: 'Rerank model',
  vision: 'Vision model'
};

function emptyEndpoint(): EndpointDraft {
  return {
    provider: 'openai-compatible',
    baseURL: 'https://api.openai.com/v1',
    model: 'gpt-5',
    apiKey: ''
  };
}

function endpointFromSettings(settings: PublicLlmSettings | null, key: 'chat' | 'embedding' | 'vision'): EndpointDraft {
  if (!settings) {
    return key === 'embedding'
      ? {
          provider: 'openai-compatible',
          baseURL: 'https://api.openai.com/v1',
          model: 'text-embedding-3-small',
          apiKey: ''
        }
      : emptyEndpoint();
  }

  return {
    provider: settings[key].provider,
    baseURL: settings[key].baseURL,
    model: settings[key].model,
    apiKey: ''
  };
}

function rerankFromSettings(settings: PublicLlmSettings | null): RerankEndpointDraft {
  return {
    provider: settings?.rerank.provider ?? 'siliconflow-compatible',
    baseURL: settings?.rerank.baseURL ?? 'https://api.siliconflow.cn/v1',
    model: settings?.rerank.model ?? 'BAAI/bge-reranker-v2-m3',
    apiKey: '',
    enabled: settings?.rerank.enabled ?? true
  };
}

function defaultsForProvider(provider: LlmProviderKind, currentModel: string) {
  if (provider === 'deepseek') {
    return {
      baseURL: 'https://api.deepseek.com',
      model: currentModel === 'text-embedding-3-small' ? currentModel : 'deepseek-v4-flash'
    };
  }
  if (provider === 'anthropic-compatible') {
    return {
      baseURL: 'https://api.anthropic.com/v1',
      model: currentModel === 'text-embedding-3-small' ? currentModel : 'claude-sonnet-4-5'
    };
  }

  return {
    baseURL: 'https://api.openai.com/v1',
    model: currentModel === 'claude-sonnet-4-5' ? 'gpt-5' : currentModel
  };
}

function knowledgeFromSettings(settings: PublicLlmSettings | null): KnowledgeDraft {
  return {
    pdfExtractionEngine: settings?.knowledge.pdfExtractionEngine ?? 'pdfjs',
    mineruApiKey: '',
    mineruModelVersion: settings?.knowledge.mineru.modelVersion ?? 'vlm',
    mineruLanguage: settings?.knowledge.mineru.language ?? 'ch',
    mineruIsOcr: settings?.knowledge.mineru.isOcr ?? false,
    mineruEnableTable: settings?.knowledge.mineru.enableTable ?? true,
    mineruEnableFormula: settings?.knowledge.mineru.enableFormula ?? true,
    retrieval: settings?.knowledge.retrieval ?? defaultKnowledgeRetrieval
  };
}

export function SettingsDialog({
  open,
  settings,
  debugEnabled,
  onOpenChange,
  onSaved,
  onAppearancePreview,
  onDebugEnabledChange,
  onError,
  onStatus
}: {
  open: boolean;
  settings: PublicLlmSettings | null;
  debugEnabled: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (settings: PublicLlmSettings) => void;
  onAppearancePreview: (appearance: AppearanceSettings) => void;
  onDebugEnabledChange: (enabled: boolean) => void;
  onError: (message: string) => void;
  onStatus: (message: string) => void;
}) {
  const [activeSection, setActiveSection] = useState<SettingsSectionId>('general');
  const [chat, setChat] = useState<EndpointDraft>(() => endpointFromSettings(settings, 'chat'));
  const [embedding, setEmbedding] = useState<EndpointDraft>(() => endpointFromSettings(settings, 'embedding'));
  const [rerank, setRerank] = useState<RerankEndpointDraft>(() => rerankFromSettings(settings));
  const [vision, setVision] = useState<EndpointDraft>(() => endpointFromSettings(settings, 'vision'));
  const [knowledge, setKnowledge] = useState<KnowledgeDraft>(() => knowledgeFromSettings(settings));
  const [appearance, setAppearance] = useState<AppearanceSettings>(settings?.appearance ?? defaultAppearance);
  const [appearanceSaving, setAppearanceSaving] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setChat(endpointFromSettings(settings, 'chat'));
    setEmbedding(endpointFromSettings(settings, 'embedding'));
    setRerank(rerankFromSettings(settings));
    setVision(endpointFromSettings(settings, 'vision'));
    setKnowledge(knowledgeFromSettings(settings));
  }, [
    settings?.chat.provider,
    settings?.chat.baseURL,
    settings?.chat.model,
    settings?.embedding.provider,
    settings?.embedding.baseURL,
    settings?.embedding.model,
    settings?.rerank.provider,
    settings?.rerank.baseURL,
    settings?.rerank.model,
    settings?.rerank.enabled,
    settings?.vision.provider,
    settings?.vision.baseURL,
    settings?.vision.model,
    settings?.knowledge.pdfExtractionEngine,
    settings?.knowledge.mineru.modelVersion,
    settings?.knowledge.mineru.language,
    settings?.knowledge.mineru.isOcr,
    settings?.knowledge.mineru.enableTable,
    settings?.knowledge.mineru.enableFormula,
    settings?.knowledge.retrieval.maxRetrievedChunks,
    settings?.knowledge.retrieval.maxCandidateChunks,
    settings?.knowledge.retrieval.rerankTopN,
    settings?.knowledge.retrieval.adjacentChunkRadius,
    settings?.knowledge.retrieval.maxChunksPerItem,
    settings?.knowledge.retrieval.chunkTargetChars,
    settings?.knowledge.retrieval.chunkOverlapChars,
    settings?.knowledge.retrieval.embeddingBatchSize,
    open
  ]);

  useEffect(() => {
    if (appearanceSaving) {
      return;
    }
    setAppearance(settings?.appearance ?? defaultAppearance);
  }, [
    appearanceSaving,
    settings?.appearance.theme,
    settings?.appearance.accentColor,
    settings?.appearance.fontFamily,
    open
  ]);

  const canSave = useMemo(() => {
    return [chat, embedding, vision, rerank].every((endpoint) => endpoint.baseURL.trim() && endpoint.model.trim())
      && knowledge.mineruLanguage.trim();
  }, [chat, embedding, vision, rerank, knowledge.mineruLanguage]);

  function updateEndpoint(
    section: ModelEndpointSectionId,
    updater: (current: EndpointDraft) => EndpointDraft
  ) {
    const setter = section === 'chat' ? setChat : section === 'embedding' ? setEmbedding : setVision;
    setter(updater);
  }

  function updateProvider(section: ModelEndpointSectionId, provider: LlmProviderKind) {
    updateEndpoint(section, (current) => {
      const nextDefaults = defaultsForProvider(provider, current.model);
      const shouldReplaceBaseURL =
        current.baseURL === 'https://api.openai.com/v1' ||
        current.baseURL === 'https://api.anthropic.com/v1' ||
        current.baseURL === 'https://api.deepseek.com';

      return {
        ...current,
        provider,
        baseURL: shouldReplaceBaseURL ? nextDefaults.baseURL : current.baseURL,
        model: nextDefaults.model
      };
    });
  }

  async function saveSettings() {
    try {
      setSaving(true);
      const next = await getApi().updateLlmSettings({
        provider: chat.provider,
        baseURL: chat.baseURL,
        model: chat.model,
        apiKey: chat.apiKey.trim() ? chat.apiKey : undefined,
        embeddingProvider: embedding.provider,
        embeddingBaseURL: embedding.baseURL,
        embeddingModel: embedding.model,
        embeddingApiKey: embedding.apiKey.trim() ? embedding.apiKey : undefined,
        rerankProvider: rerank.provider,
        rerankBaseURL: rerank.baseURL,
        rerankModel: rerank.model,
        rerankApiKey: rerank.apiKey.trim() ? rerank.apiKey : undefined,
        rerankEnabled: rerank.enabled,
        visionProvider: vision.provider,
        visionBaseURL: vision.baseURL,
        visionModel: vision.model,
        visionApiKey: vision.apiKey.trim() ? vision.apiKey : undefined,
        knowledgePdfExtractionEngine: knowledge.pdfExtractionEngine,
        mineruApiKey: knowledge.mineruApiKey.trim() ? knowledge.mineruApiKey : undefined,
        mineruModelVersion: knowledge.mineruModelVersion,
        mineruLanguage: knowledge.mineruLanguage,
        mineruIsOcr: knowledge.mineruIsOcr,
        mineruEnableTable: knowledge.mineruEnableTable,
        mineruEnableFormula: knowledge.mineruEnableFormula,
        knowledgeRetrieval: knowledge.retrieval
      });
      onSaved(next);
      setChat((current) => ({ ...current, apiKey: '' }));
      setEmbedding((current) => ({ ...current, apiKey: '' }));
      setRerank((current) => ({ ...current, apiKey: '' }));
      setVision((current) => ({ ...current, apiKey: '' }));
      setKnowledge((current) => ({ ...current, mineruApiKey: '' }));
      onStatus('Settings saved.');
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  }

  async function updateAppearance(partial: Partial<AppearanceSettings>) {
    const previousAppearance = appearance;
    const nextAppearance = { ...appearance, ...partial };
    setAppearanceSaving(true);
    setAppearance(nextAppearance);
    onAppearancePreview(nextAppearance);
    try {
      const next = await getApi().updateAppearanceSettings(nextAppearance);
      onSaved(next);
      onStatus('Appearance updated.');
    } catch (caught) {
      setAppearance(previousAppearance);
      onAppearancePreview(previousAppearance);
      onError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setAppearanceSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid h-[min(720px,calc(100svh-2rem))] w-[calc(100vw-2rem)] grid-rows-[minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:max-w-5xl!">
        <DialogTitle className="sr-only">Settings</DialogTitle>
        <DialogDescription className="sr-only">Configure global behavior and model providers.</DialogDescription>
        <SidebarProvider
          className="h-full min-h-0! items-stretch overflow-hidden"
          style={
            {
              '--sidebar-width': '15.5rem'
            } as React.CSSProperties
          }
          >
          <Sidebar collapsible="none" className="hidden h-full md:flex">
            <SidebarContent>
              {navGroups.map((group) => (
                <SidebarGroup key={group.label}>
                  <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
                  <SidebarGroupContent>
                    <SidebarMenu>
                      {group.items.map((item) => (
                        <SidebarMenuItem key={item.id}>
                          <SidebarMenuButton
                            isActive={activeSection === item.id}
                            onClick={() => setActiveSection(item.id)}
                          >
                            {item.icon}
                            <span>{item.label}</span>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      ))}
                    </SidebarMenu>
                  </SidebarGroupContent>
                </SidebarGroup>
              ))}
            </SidebarContent>
          </Sidebar>

          <main className="grid min-h-0 min-w-0 flex-1 grid-rows-[auto_auto_minmax(0,1fr)_auto] overflow-hidden">
            <header className="flex h-14 items-center justify-between gap-3 border-b px-4 pr-12">
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground">Settings</p>
                <h2 className="truncate text-base font-medium">{sectionTitles[activeSection]}</h2>
              </div>
              <Button
                size="sm"
                onClick={() => void saveSettings()}
                disabled={!canSave || saving}
              >
                <Save />
                {saving ? 'Saving' : 'Save settings'}
              </Button>
            </header>

            <div className="flex gap-2 overflow-x-auto border-b p-2 md:hidden">
              {navGroups.flatMap((group) => group.items).map((item) => (
                <Button
                  key={item.id}
                  variant={activeSection === item.id ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={() => setActiveSection(item.id)}
                >
                  {item.icon}
                  {item.label}
                </Button>
              ))}
            </div>

            <div className="min-h-0 overflow-y-auto overscroll-contain p-4">
              {activeSection === 'general' ? (
                <GeneralSettings
                  debugEnabled={debugEnabled}
                  onDebugEnabledChange={onDebugEnabledChange}
                />
              ) : activeSection === 'appearance' ? (
                <AppearanceSettingsPanel
                  appearance={appearance}
                  appearanceSaving={appearanceSaving}
                  onAppearanceChange={(partial) => void updateAppearance(partial)}
                />
              ) : activeSection === 'knowledge' ? (
                <KnowledgeSettings
                  knowledge={knowledge}
                  hasMineruApiKey={settings?.knowledge.mineru.hasApiKey ?? false}
                  onChange={setKnowledge}
                />
              ) : activeSection === 'chat' ? (
                <EndpointSettings
                  title="Chat"
                  description="Used for writing assist and model-assisted workspace operations."
                  endpoint={chat}
                  hasApiKey={settings?.chat.hasApiKey ?? false}
                  onProviderChange={(provider) => updateProvider('chat', provider)}
                  onChange={(updater) => updateEndpoint('chat', updater)}
                />
              ) : activeSection === 'embedding' ? (
                <EndpointSettings
                  title="Embeddings"
                  description="Used to index and retrieve knowledge sources."
                  endpoint={embedding}
                  hasApiKey={settings?.embedding.hasApiKey ?? false}
                  onProviderChange={(provider) => updateProvider('embedding', provider)}
                  onChange={(updater) => updateEndpoint('embedding', updater)}
                />
              ) : activeSection === 'rerank' ? (
                <RerankSettings
                  endpoint={rerank}
                  hasApiKey={settings?.rerank.hasApiKey ?? false}
                  onChange={(updater) => setRerank(updater)}
                />
              ) : (
                <EndpointSettings
                  title="Vision"
                  description="Reserved for later image-aware model flows."
                  endpoint={vision}
                  hasApiKey={settings?.vision.hasApiKey ?? false}
                  onProviderChange={(provider) => updateProvider('vision', provider)}
                  onChange={(updater) => updateEndpoint('vision', updater)}
                />
              )}
            </div>

            <footer className="flex items-center justify-between gap-3 border-t bg-popover px-4 py-3">
              <p className="min-w-0 truncate text-xs text-muted-foreground">
                {getSettingsFooterMessage(activeSection)}
              </p>
            </footer>
          </main>
        </SidebarProvider>
      </DialogContent>
    </Dialog>
  );
}

function getSettingsFooterMessage(activeSection: SettingsSectionId): string {
  if (activeSection === 'general') {
    return 'Debug mode is saved automatically.';
  }
  if (activeSection === 'appearance') {
    return 'Appearance changes apply immediately.';
  }
  if (activeSection === 'knowledge') {
    return 'Knowledge retrieval, indexing, and PDF extraction changes are saved with Save settings.';
  }
  return 'Provider changes are saved together with Save settings.';
}

function GeneralSettings({
  debugEnabled,
  onDebugEnabledChange
}: {
  debugEnabled: boolean;
  onDebugEnabledChange: (enabled: boolean) => void;
}) {
  return (
    <FieldGroup className="mx-auto w-full max-w-3xl gap-6">
      <FieldSet className="border-b pb-6">
        <Field orientation="horizontal" className="items-start justify-between gap-4">
          <FieldContent>
            <FieldLabel htmlFor="settings-debug-mode">Debug mode</FieldLabel>
            <FieldDescription>Show indexing diagnostics in the knowledge workspace.</FieldDescription>
          </FieldContent>
          <Switch
            id="settings-debug-mode"
            checked={debugEnabled}
            onCheckedChange={onDebugEnabledChange}
          />
        </Field>
        <FieldDescription className="flex items-center gap-2">
          <Bug className="size-4" />
          <span>{debugEnabled ? 'Debug details are visible.' : 'Debug details are hidden.'}</span>
        </FieldDescription>
      </FieldSet>
    </FieldGroup>
  );
}

function AppearanceSettingsPanel({
  appearance,
  appearanceSaving,
  onAppearanceChange
}: {
  appearance: AppearanceSettings;
  appearanceSaving: boolean;
  onAppearanceChange: (partial: Partial<AppearanceSettings>) => void;
}) {
  return (
    <FieldGroup className="mx-auto w-full max-w-3xl gap-6">
      <FieldSet className="border-b pb-6">
        <Field className="gap-3">
          <FieldContent>
            <FieldLabel>Environment</FieldLabel>
            <FieldDescription>Choose a fixed theme or follow the operating system appearance.</FieldDescription>
          </FieldContent>
          <div className="appearance-theme-grid" role="radiogroup" aria-label="Environment theme">
            {themeOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                disabled={appearanceSaving}
                role="radio"
                aria-checked={appearance.theme === option.value}
                onClick={() => onAppearanceChange({ theme: option.value })}
                className="appearance-theme-button"
              >
                <span className="appearance-theme-preview" data-theme-preview={option.value} aria-hidden="true">
                  {option.icon}
                </span>
                <span>{option.label}</span>
              </button>
            ))}
          </div>
        </Field>
        <FieldDescription className="flex items-center gap-2">
          {appearance.theme === 'system' ? <MonitorCog className="size-4" /> : appearance.theme === 'dark' ? <Moon className="size-4" /> : <Sun className="size-4" />}
          <span>
            {appearanceSaving
              ? 'Saving appearance...'
              : appearance.theme === 'system'
                ? 'Theme follows the operating system.'
                : appearance.theme === 'dark'
                  ? 'Dark theme is active.'
                  : 'Light theme is active.'}
          </span>
        </FieldDescription>
      </FieldSet>
      <FieldSet className="border-b pb-6">
        <FieldLegend variant="label">Accent color</FieldLegend>
        <FieldDescription>Choose the global color used for primary controls, focus rings, and selection accents.</FieldDescription>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {accentOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              disabled={appearanceSaving}
              aria-pressed={appearance.accentColor === option.value}
              onClick={() => onAppearanceChange({ accentColor: option.value })}
              className="flex min-h-10 items-center gap-2 rounded-md border bg-background px-2.5 text-left text-sm transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50 aria-pressed:border-ring aria-pressed:bg-accent aria-pressed:text-accent-foreground aria-pressed:ring-2 aria-pressed:ring-ring/40"
            >
              <span
                className="size-4 shrink-0 rounded-full ring-1 ring-foreground/15"
                style={{ backgroundColor: option.swatch }}
                aria-hidden="true"
              />
              <span className="min-w-0 truncate">{option.label}</span>
            </button>
          ))}
        </div>
      </FieldSet>
      <FieldSet className="border-b pb-6">
        <FieldLegend variant="label">Font</FieldLegend>
        <FieldDescription>Choose the global interface font without adding bundled font dependencies.</FieldDescription>
        <div className="appearance-font-grid" role="group" aria-label="Font family">
          {fontOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              disabled={appearanceSaving}
              aria-pressed={appearance.fontFamily === option.value}
              onClick={() => onAppearanceChange({ fontFamily: option.value })}
              className="appearance-font-card"
            >
              <span
                className="appearance-font-preview"
                style={{ fontFamily: option.previewFont }}
                aria-hidden="true"
              >
                Aa
              </span>
              <span className="appearance-font-label">{option.label}</span>
            </button>
          ))}
        </div>
      </FieldSet>
    </FieldGroup>
  );
}

function KnowledgeSettings({
  knowledge,
  hasMineruApiKey,
  onChange
}: {
  knowledge: KnowledgeDraft;
  hasMineruApiKey: boolean;
  onChange: (next: KnowledgeDraft) => void;
}) {
  function update(partial: Partial<KnowledgeDraft>) {
    onChange({ ...knowledge, ...partial });
  }

  function updateRetrieval<K extends keyof KnowledgeRetrievalSettings>(
    key: K,
    value: KnowledgeRetrievalSettings[K]
  ) {
    update({
      retrieval: {
        ...knowledge.retrieval,
        [key]: value
      }
    });
  }

  const mineruApiKeyMissing =
    knowledge.pdfExtractionEngine === 'mineru' && !hasMineruApiKey && !knowledge.mineruApiKey.trim();
  const mineruLanguageMissing = !knowledge.mineruLanguage.trim();

  return (
    <FieldGroup className="mx-auto w-full max-w-3xl gap-6">
      <FieldSet className="border-b pb-4">
        <FieldLegend className="flex items-center gap-2">
          <FileText className="size-4 text-muted-foreground" />
          PDF extraction
        </FieldLegend>
        <FieldDescription>Choose how imported PDF files are converted before text indexing.</FieldDescription>
      </FieldSet>

      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="knowledge-pdf-engine">Engine</FieldLabel>
          <Select
            value={knowledge.pdfExtractionEngine}
            onValueChange={(value) => update({ pdfExtractionEngine: value as PdfExtractionEngine })}
          >
            <SelectTrigger id="knowledge-pdf-engine" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pdfjs">pdfjs local text extraction</SelectItem>
              <SelectItem value="mineru">MinerU precise extraction</SelectItem>
            </SelectContent>
          </Select>
          <FieldDescription>Use the local parser by default; MinerU enables more precise PDF extraction.</FieldDescription>
        </Field>

        <FieldSet className="settings-subsection">
          <FieldLegend variant="label">Retrieval</FieldLegend>
          <FieldDescription>Control how many knowledge chunks are gathered, reranked, and sent into assistant suggestions.</FieldDescription>
          <div className="grid gap-4 sm:grid-cols-2">
            <NumberSettingField
              id="knowledge-max-retrieved-chunks"
              label="Final chunks"
              value={knowledge.retrieval.maxRetrievedChunks}
              min={1}
              max={20}
              description="Maximum source chunks sent to the assistant."
              onChange={(value) => updateRetrieval('maxRetrievedChunks', value)}
            />
            <NumberSettingField
              id="knowledge-max-candidate-chunks"
              label="Candidate chunks"
              value={knowledge.retrieval.maxCandidateChunks}
              min={1}
              max={80}
              description="Hybrid search candidates considered before rerank."
              onChange={(value) => updateRetrieval('maxCandidateChunks', value)}
            />
            <NumberSettingField
              id="knowledge-rerank-top-n"
              label="Rerank filter count"
              value={knowledge.retrieval.rerankTopN}
              min={1}
              max={80}
              description="Requested rerank results before final trimming."
              onChange={(value) => updateRetrieval('rerankTopN', value)}
            />
            <NumberSettingField
              id="knowledge-adjacent-chunk-radius"
              label="Adjacent radius"
              value={knowledge.retrieval.adjacentChunkRadius}
              min={0}
              max={3}
              description="Neighbor chunks added around strong matches."
              onChange={(value) => updateRetrieval('adjacentChunkRadius', value)}
            />
            <NumberSettingField
              id="knowledge-max-chunks-per-item"
              label="Chunks per source"
              value={knowledge.retrieval.maxChunksPerItem}
              min={1}
              max={20}
              description="Initial cap for chunks from the same source."
              onChange={(value) => updateRetrieval('maxChunksPerItem', value)}
            />
          </div>
        </FieldSet>

        <FieldSet className="settings-subsection">
          <FieldLegend variant="label">Advanced indexing</FieldLegend>
          <FieldDescription>These values affect new or reindexed knowledge items only.</FieldDescription>
          <div className="grid gap-4 sm:grid-cols-2">
            <NumberSettingField
              id="knowledge-chunk-target-chars"
              label="Chunk size"
              value={knowledge.retrieval.chunkTargetChars}
              min={200}
              max={3000}
              description="Target characters per indexed chunk."
              onChange={(value) => updateRetrieval('chunkTargetChars', value)}
            />
            <NumberSettingField
              id="knowledge-chunk-overlap-chars"
              label="Chunk overlap"
              value={knowledge.retrieval.chunkOverlapChars}
              min={0}
              max={1000}
              description="Characters repeated between neighboring chunks."
              onChange={(value) => updateRetrieval('chunkOverlapChars', value)}
            />
            <NumberSettingField
              id="knowledge-embedding-batch-size"
              label="Embedding batch size"
              value={knowledge.retrieval.embeddingBatchSize}
              min={1}
              max={256}
              description="Maximum chunks embedded in each request."
              onChange={(value) => updateRetrieval('embeddingBatchSize', value)}
            />
          </div>
        </FieldSet>

        <FieldSet className="settings-subsection">
          <FieldLegend variant="label">MinerU</FieldLegend>
          <Field data-invalid={mineruApiKeyMissing}>
            <FieldLabel htmlFor="mineru-api-key">API key</FieldLabel>
            <div className="relative">
              <KeyRound className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="mineru-api-key"
                className="pl-8"
                value={knowledge.mineruApiKey}
                type="password"
                onChange={(event) => update({ mineruApiKey: event.target.value })}
                placeholder={hasMineruApiKey ? 'Stored; enter a new key to replace' : 'MinerU API key'}
                aria-invalid={mineruApiKeyMissing}
              />
            </div>
            {mineruApiKeyMissing ? (
              <FieldError>MinerU needs an API key when selected as the PDF engine.</FieldError>
            ) : (
              <FieldDescription>
                {hasMineruApiKey ? 'API key saved; enter a new key to replace it.' : 'Stored securely after saving settings.'}
              </FieldDescription>
            )}
          </Field>

          <Field>
            <FieldLabel htmlFor="mineru-model-version">Model version</FieldLabel>
            <Select
              value={knowledge.mineruModelVersion}
              onValueChange={(value) => update({ mineruModelVersion: value as MineruModelVersion })}
            >
              <SelectTrigger id="mineru-model-version" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="vlm">vlm</SelectItem>
                <SelectItem value="pipeline">pipeline</SelectItem>
              </SelectContent>
            </Select>
            <FieldDescription>Select the MinerU extraction model used for imported PDFs.</FieldDescription>
          </Field>

          <Field data-invalid={mineruLanguageMissing}>
            <FieldLabel htmlFor="mineru-language">Language</FieldLabel>
            <Input
              id="mineru-language"
              value={knowledge.mineruLanguage}
              onChange={(event) => update({ mineruLanguage: event.target.value })}
              aria-invalid={mineruLanguageMissing}
            />
            {mineruLanguageMissing ? (
              <FieldError>Language is required.</FieldError>
            ) : (
              <FieldDescription>Pass the document language hint to MinerU, such as ch or en.</FieldDescription>
            )}
          </Field>

          <Field orientation="horizontal">
            <Checkbox
              id="mineru-ocr-mode"
              checked={knowledge.mineruIsOcr}
              onCheckedChange={(checked) => update({ mineruIsOcr: checked === true })}
            />
            <FieldContent>
              <FieldLabel htmlFor="mineru-ocr-mode">OCR mode</FieldLabel>
              <FieldDescription>Force OCR when the source PDF does not contain reliable text.</FieldDescription>
            </FieldContent>
          </Field>

          <Field orientation="horizontal">
            <Checkbox
              id="mineru-extract-tables"
              checked={knowledge.mineruEnableTable}
              onCheckedChange={(checked) => update({ mineruEnableTable: checked === true })}
            />
            <FieldContent>
              <FieldLabel htmlFor="mineru-extract-tables">Extract tables</FieldLabel>
              <FieldDescription>Keep table structure when parsing technical or tabular documents.</FieldDescription>
            </FieldContent>
          </Field>

          <Field orientation="horizontal">
            <Checkbox
              id="mineru-extract-formulas"
              checked={knowledge.mineruEnableFormula}
              onCheckedChange={(checked) => update({ mineruEnableFormula: checked === true })}
            />
            <FieldContent>
              <FieldLabel htmlFor="mineru-extract-formulas">Extract formulas</FieldLabel>
              <FieldDescription>Preserve formulas for retrieval and citation-heavy writing.</FieldDescription>
            </FieldContent>
          </Field>
        </FieldSet>
      </FieldGroup>
    </FieldGroup>
  );
}

function NumberSettingField({
  id,
  label,
  value,
  min,
  max,
  description,
  onChange
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  description: string;
  onChange: (value: number) => void;
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(event) => {
          const next = event.currentTarget.valueAsNumber;
          onChange(Number.isFinite(next) ? Math.trunc(next) : 0);
        }}
      />
      <FieldDescription>
        {description} Range {min}-{max}.
      </FieldDescription>
    </Field>
  );
}

function RerankSettings({
  endpoint,
  hasApiKey,
  onChange
}: {
  endpoint: RerankEndpointDraft;
  hasApiKey: boolean;
  onChange: (updater: (current: RerankEndpointDraft) => RerankEndpointDraft) => void;
}) {
  const baseUrlMissing = !endpoint.baseURL.trim();
  const modelMissing = !endpoint.model.trim();

  return (
    <FieldGroup className="mx-auto w-full max-w-3xl gap-6">
      <FieldSet className="border-b pb-4">
        <FieldLegend className="flex items-center gap-2">
          <Cpu className="size-4 text-muted-foreground" />
          Rerank
        </FieldLegend>
        <FieldDescription>Used to rerank retrieved knowledge candidates.</FieldDescription>
      </FieldSet>

      <FieldGroup>
        <Field orientation="horizontal">
          <Checkbox
            id="rerank-enabled"
            checked={endpoint.enabled}
            onCheckedChange={(checked) => onChange((current) => ({ ...current, enabled: checked === true }))}
          />
          <FieldContent>
            <FieldLabel htmlFor="rerank-enabled">Enable rerank</FieldLabel>
            <FieldDescription>Improve source ordering after initial knowledge retrieval.</FieldDescription>
          </FieldContent>
        </Field>

        <Field>
          <FieldLabel htmlFor="rerank-provider">Provider</FieldLabel>
          <Select
            value={endpoint.provider}
            onValueChange={(value) =>
              onChange((current) => ({ ...current, provider: value as RerankProviderKind }))
            }
          >
            <SelectTrigger id="rerank-provider" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="siliconflow-compatible">SiliconFlow compatible</SelectItem>
            </SelectContent>
          </Select>
          <FieldDescription>Provider compatibility profile for rerank requests.</FieldDescription>
        </Field>

        <Field data-invalid={baseUrlMissing}>
          <FieldLabel htmlFor="rerank-base-url">Base URL</FieldLabel>
          <div className="relative">
            <SlidersHorizontal className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="rerank-base-url"
              className="pl-8"
              value={endpoint.baseURL}
              onChange={(event) => onChange((current) => ({ ...current, baseURL: event.target.value }))}
              aria-invalid={baseUrlMissing}
            />
          </div>
          {baseUrlMissing ? (
            <FieldError>Base URL is required.</FieldError>
          ) : (
            <FieldDescription>Endpoint root used for rerank API calls.</FieldDescription>
          )}
        </Field>

        <Field data-invalid={modelMissing}>
          <FieldLabel htmlFor="rerank-model">Model</FieldLabel>
          <Input
            id="rerank-model"
            value={endpoint.model}
            onChange={(event) => onChange((current) => ({ ...current, model: event.target.value }))}
            aria-invalid={modelMissing}
          />
          {modelMissing ? (
            <FieldError>Model is required.</FieldError>
          ) : (
            <FieldDescription>Model identifier sent to the rerank provider.</FieldDescription>
          )}
        </Field>

        <Field>
          <FieldLabel htmlFor="rerank-api-key">API key</FieldLabel>
          <div className="relative">
            <KeyRound className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="rerank-api-key"
              className="pl-8"
              value={endpoint.apiKey}
              type="password"
              onChange={(event) => onChange((current) => ({ ...current, apiKey: event.target.value }))}
              placeholder={hasApiKey ? 'Stored; enter a new key to replace' : 'SiliconFlow API key'}
            />
          </div>
          <FieldDescription>
            {hasApiKey ? 'API key saved; enter a new key to replace it.' : 'Stored securely after saving settings.'}
          </FieldDescription>
        </Field>
      </FieldGroup>
    </FieldGroup>
  );
}

function EndpointSettings({
  title,
  description,
  endpoint,
  hasApiKey,
  onProviderChange,
  onChange
}: {
  title: string;
  description: string;
  endpoint: EndpointDraft;
  hasApiKey: boolean;
  onProviderChange: (provider: LlmProviderKind) => void;
  onChange: (updater: (current: EndpointDraft) => EndpointDraft) => void;
}) {
  const endpointProviderOptions = title === 'Chat'
    ? providerOptions
    : providerOptions.filter((provider) => provider.value !== 'deepseek');
  const fieldIdPrefix = title.toLowerCase().replace(/\s+/g, '-');
  const baseUrlMissing = !endpoint.baseURL.trim();
  const modelMissing = !endpoint.model.trim();
  const apiKeyMissing = !hasApiKey && !endpoint.apiKey.trim();

  return (
    <FieldGroup className="mx-auto w-full max-w-3xl gap-6">
      <FieldSet className="border-b pb-4">
        <FieldLegend className="flex items-center gap-2">
          <Cpu className="size-4 text-muted-foreground" />
          {title}
        </FieldLegend>
        <FieldDescription>{description}</FieldDescription>
      </FieldSet>

      <FieldGroup>
        <Field>
          <FieldLabel htmlFor={`${fieldIdPrefix}-provider`}>Provider</FieldLabel>
          <Select value={endpoint.provider} onValueChange={(value) => onProviderChange(value as LlmProviderKind)}>
            <SelectTrigger id={`${fieldIdPrefix}-provider`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {endpointProviderOptions.map((provider) => (
                <SelectItem key={provider.value} value={provider.value}>
                  {provider.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldDescription>
            {title === 'Chat'
              ? 'Select the provider compatibility profile for the writing assistant.'
              : 'Select the provider compatibility profile for this endpoint.'}
          </FieldDescription>
        </Field>

        <Field data-invalid={baseUrlMissing}>
          <FieldLabel htmlFor={`${fieldIdPrefix}-base-url`}>Base URL</FieldLabel>
          <div className="relative">
            <SlidersHorizontal className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id={`${fieldIdPrefix}-base-url`}
              className="pl-8"
              value={endpoint.baseURL}
              onChange={(event) => onChange((current) => ({ ...current, baseURL: event.target.value }))}
              aria-invalid={baseUrlMissing}
            />
          </div>
          {baseUrlMissing ? (
            <FieldError>Base URL is required.</FieldError>
          ) : (
            <FieldDescription>Endpoint root used for model API requests.</FieldDescription>
          )}
        </Field>

        <Field data-invalid={modelMissing}>
          <FieldLabel htmlFor={`${fieldIdPrefix}-model`}>Model</FieldLabel>
          <Input
            id={`${fieldIdPrefix}-model`}
            value={endpoint.model}
            onChange={(event) => onChange((current) => ({ ...current, model: event.target.value }))}
            aria-invalid={modelMissing}
          />
          {modelMissing ? (
            <FieldError>Model is required.</FieldError>
          ) : (
            <FieldDescription>Model identifier sent to the configured provider.</FieldDescription>
          )}
        </Field>

        <Field data-invalid={apiKeyMissing}>
          <FieldLabel htmlFor={`${fieldIdPrefix}-api-key`}>API key</FieldLabel>
          <div className="relative">
            <KeyRound className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id={`${fieldIdPrefix}-api-key`}
              className="pl-8"
              value={endpoint.apiKey}
              type="password"
              onChange={(event) => onChange((current) => ({ ...current, apiKey: event.target.value }))}
              placeholder={hasApiKey ? 'Stored; enter a new key to replace' : 'API key'}
              aria-invalid={apiKeyMissing}
            />
          </div>
          {apiKeyMissing ? (
            <FieldError>No API key is stored for this endpoint.</FieldError>
          ) : (
            <FieldDescription>
              {hasApiKey ? 'API key saved; enter a new key to replace it.' : 'Stored securely after saving settings.'}
            </FieldDescription>
          )}
        </Field>
      </FieldGroup>
    </FieldGroup>
  );
}
