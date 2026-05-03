import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Bug,
  Cpu,
  Database,
  Eye,
  KeyRound,
  MessageSquareText,
  Moon,
  Save,
  Settings2,
  SlidersHorizontal,
  Sun
} from 'lucide-react';
import { getApi } from '../../api';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle
} from '../../components/ui/dialog';
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
import { cn } from '../../lib/utils';
import type { LlmProviderKind, PublicLlmSettings, ThemeMode } from '../../../shared/types';

type SettingsSectionId = 'general' | 'chat' | 'embedding' | 'vision';

type EndpointDraft = {
  provider: LlmProviderKind;
  baseURL: string;
  model: string;
  apiKey: string;
};

const providerOptions: { value: LlmProviderKind; label: string }[] = [
  { value: 'openai-compatible', label: 'OpenAI compatible' },
  { value: 'anthropic-compatible', label: 'Anthropic compatible' }
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
    items: [{ id: 'general', label: 'General', icon: <Settings2 /> }]
  },
  {
    label: 'LLM',
    items: [
      { id: 'chat', label: 'Chat', icon: <MessageSquareText /> },
      { id: 'embedding', label: 'Embeddings', icon: <Database /> },
      { id: 'vision', label: 'Vision', icon: <Eye /> }
    ]
  }
];

const sectionTitles: Record<SettingsSectionId, string> = {
  general: 'General',
  chat: 'Chat model',
  embedding: 'Embedding model',
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

function defaultsForProvider(provider: LlmProviderKind, currentModel: string) {
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

export function SettingsDialog({
  open,
  settings,
  debugEnabled,
  onOpenChange,
  onSaved,
  onThemePreview,
  onDebugEnabledChange,
  onError,
  onStatus
}: {
  open: boolean;
  settings: PublicLlmSettings | null;
  debugEnabled: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (settings: PublicLlmSettings) => void;
  onThemePreview: (theme: ThemeMode) => void;
  onDebugEnabledChange: (enabled: boolean) => void;
  onError: (message: string) => void;
  onStatus: (message: string) => void;
}) {
  const [activeSection, setActiveSection] = useState<SettingsSectionId>('general');
  const [chat, setChat] = useState<EndpointDraft>(() => endpointFromSettings(settings, 'chat'));
  const [embedding, setEmbedding] = useState<EndpointDraft>(() => endpointFromSettings(settings, 'embedding'));
  const [vision, setVision] = useState<EndpointDraft>(() => endpointFromSettings(settings, 'vision'));
  const [theme, setTheme] = useState<ThemeMode>(settings?.appearance.theme ?? 'light');
  const [themeSaving, setThemeSaving] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setChat(endpointFromSettings(settings, 'chat'));
    setEmbedding(endpointFromSettings(settings, 'embedding'));
    setVision(endpointFromSettings(settings, 'vision'));
  }, [
    settings?.chat.provider,
    settings?.chat.baseURL,
    settings?.chat.model,
    settings?.embedding.provider,
    settings?.embedding.baseURL,
    settings?.embedding.model,
    settings?.vision.provider,
    settings?.vision.baseURL,
    settings?.vision.model,
    open
  ]);

  useEffect(() => {
    setTheme(settings?.appearance.theme ?? 'light');
  }, [settings?.appearance.theme, open]);

  const canSave = useMemo(() => {
    return [chat, embedding, vision].every((endpoint) => endpoint.baseURL.trim() && endpoint.model.trim());
  }, [chat, embedding, vision]);

  function updateEndpoint(
    section: Exclude<SettingsSectionId, 'general'>,
    updater: (current: EndpointDraft) => EndpointDraft
  ) {
    const setter = section === 'chat' ? setChat : section === 'embedding' ? setEmbedding : setVision;
    setter(updater);
  }

  function updateProvider(section: Exclude<SettingsSectionId, 'general'>, provider: LlmProviderKind) {
    updateEndpoint(section, (current) => {
      const nextDefaults = defaultsForProvider(provider, current.model);
      const shouldReplaceBaseURL =
        current.baseURL === 'https://api.openai.com/v1' || current.baseURL === 'https://api.anthropic.com/v1';

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
        visionProvider: vision.provider,
        visionBaseURL: vision.baseURL,
        visionModel: vision.model,
        visionApiKey: vision.apiKey.trim() ? vision.apiKey : undefined
      });
      onSaved(next);
      setChat((current) => ({ ...current, apiKey: '' }));
      setEmbedding((current) => ({ ...current, apiKey: '' }));
      setVision((current) => ({ ...current, apiKey: '' }));
      onStatus('Settings saved.');
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  }

  async function updateTheme(nextTheme: ThemeMode) {
    const previousTheme = theme;
    setTheme(nextTheme);
    onThemePreview(nextTheme);
    try {
      setThemeSaving(true);
      const next = await getApi().updateAppearanceSettings({ theme: nextTheme });
      if (!settings) {
        onSaved(next);
      }
      onStatus('Theme updated.');
    } catch (caught) {
      setTheme(previousTheme);
      onThemePreview(previousTheme);
      onError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setThemeSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid h-[min(720px,calc(100svh-2rem))] w-[calc(100vw-2rem)] max-w-5xl overflow-hidden p-0">
        <DialogTitle className="sr-only">Settings</DialogTitle>
        <DialogDescription className="sr-only">Configure global behavior and model providers.</DialogDescription>
        <SidebarProvider
          className="min-h-0! items-start"
          style={
            {
              '--sidebar-width': '15.5rem'
            } as React.CSSProperties
          }
        >
          <Sidebar collapsible="none" className="hidden md:flex">
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

          <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <header className="flex h-14 shrink-0 items-center border-b px-4">
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground">Settings</p>
                <h2 className="truncate text-base font-medium">{sectionTitles[activeSection]}</h2>
              </div>
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

            <div className="flex-1 overflow-y-auto p-4">
              {activeSection === 'general' ? (
                <GeneralSettings
                  debugEnabled={debugEnabled}
                  theme={theme}
                  themeSaving={themeSaving}
                  onDebugEnabledChange={onDebugEnabledChange}
                  onThemeChange={(nextTheme) => void updateTheme(nextTheme)}
                />
              ) : activeSection === 'chat' ? (
                <EndpointSettings
                  title="Chat"
                  description="Used for writing, generation, and model-assisted workspace operations."
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

            <footer className="flex shrink-0 items-center justify-between gap-3 border-t px-4 py-3">
              <p className="min-w-0 truncate text-xs text-muted-foreground">
                {activeSection === 'general' ? 'Global changes apply immediately.' : 'Provider changes are saved together.'}
              </p>
              <Button
                size="sm"
                onClick={() => void saveSettings()}
                disabled={!canSave || saving}
              >
                <Save />
                {saving ? 'Saving' : 'Save'}
              </Button>
            </footer>
          </main>
        </SidebarProvider>
      </DialogContent>
    </Dialog>
  );
}

function GeneralSettings({
  debugEnabled,
  theme,
  themeSaving,
  onDebugEnabledChange,
  onThemeChange
}: {
  debugEnabled: boolean;
  theme: ThemeMode;
  themeSaving: boolean;
  onDebugEnabledChange: (enabled: boolean) => void;
  onThemeChange: (theme: ThemeMode) => void;
}) {
  return (
    <div className="mx-auto grid w-full max-w-3xl gap-6">
      <section className="grid gap-4 border-b pb-6">
        <div className="flex items-start justify-between gap-4">
          <div className="grid gap-1">
            <h3 className="text-sm font-medium">Dark theme</h3>
            <p className="text-sm text-muted-foreground">Use the dark color scheme across the app.</p>
          </div>
          <label className="relative inline-flex cursor-pointer items-center">
            <input
              className="peer sr-only"
              type="checkbox"
              role="switch"
              checked={theme === 'dark'}
              disabled={themeSaving}
              onChange={(event) => onThemeChange(event.target.checked ? 'dark' : 'light')}
            />
            <span className="h-6 w-10 rounded-full bg-muted ring-1 ring-border transition-colors peer-checked:bg-primary peer-disabled:opacity-60" />
            <span className="absolute left-1 size-4 rounded-full bg-background shadow-sm transition-transform peer-checked:translate-x-4" />
          </label>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          {theme === 'dark' ? <Moon className="size-4" /> : <Sun className="size-4" />}
          <span>{themeSaving ? 'Saving theme...' : theme === 'dark' ? 'Dark theme is active.' : 'Light theme is active.'}</span>
        </div>
      </section>
      <section className="grid gap-4 border-b pb-6">
        <div className="flex items-start justify-between gap-4">
          <div className="grid gap-1">
            <h3 className="text-sm font-medium">Debug mode</h3>
            <p className="text-sm text-muted-foreground">Show indexing diagnostics in the knowledge workspace.</p>
          </div>
          <label className="relative inline-flex cursor-pointer items-center">
            <input
              className="peer sr-only"
              type="checkbox"
              role="switch"
              checked={debugEnabled}
              onChange={(event) => onDebugEnabledChange(event.target.checked)}
            />
            <span className="h-6 w-10 rounded-full bg-muted ring-1 ring-border transition-colors peer-checked:bg-primary" />
            <span className="absolute left-1 size-4 rounded-full bg-background shadow-sm transition-transform peer-checked:translate-x-4" />
          </label>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Bug className="size-4" />
          <span>{debugEnabled ? 'Debug details are visible.' : 'Debug details are hidden.'}</span>
        </div>
      </section>
    </div>
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
  return (
    <div className="mx-auto grid w-full max-w-3xl gap-6">
      <section className="grid gap-1 border-b pb-4">
        <div className="flex items-center gap-2">
          <Cpu className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-medium">{title}</h3>
        </div>
        <p className="text-sm text-muted-foreground">{description}</p>
      </section>

      <div className="grid gap-5">
        <label className="grid gap-2 text-sm font-medium">
          Provider
          <Select value={endpoint.provider} onValueChange={(value) => onProviderChange(value as LlmProviderKind)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {providerOptions.map((provider) => (
                <SelectItem key={provider.value} value={provider.value}>
                  {provider.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>

        <label className="grid gap-2 text-sm font-medium">
          Base URL
          <div className="relative">
            <SlidersHorizontal className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-8"
              value={endpoint.baseURL}
              onChange={(event) => onChange((current) => ({ ...current, baseURL: event.target.value }))}
            />
          </div>
        </label>

        <label className="grid gap-2 text-sm font-medium">
          Model
          <Input
            value={endpoint.model}
            onChange={(event) => onChange((current) => ({ ...current, model: event.target.value }))}
          />
        </label>

        <label className="grid gap-2 text-sm font-medium">
          API key
          <div className="relative">
            <KeyRound className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-8"
              value={endpoint.apiKey}
              type="password"
              onChange={(event) => onChange((current) => ({ ...current, apiKey: event.target.value }))}
              placeholder={hasApiKey ? 'Stored; enter a new key to replace' : 'API key'}
            />
          </div>
          <span className={cn('text-xs font-normal', hasApiKey ? 'text-muted-foreground' : 'text-destructive')}>
            {hasApiKey ? 'API key saved' : 'API key missing'}
          </span>
        </label>
      </div>
    </div>
  );
}
