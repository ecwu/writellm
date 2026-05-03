
import { useEffect, useState } from 'react';
import { Bug, Save } from 'lucide-react';
import { getApi } from '../../api';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../../components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '../../components/ui/sheet';
import type { LlmProviderKind, PublicLlmSettings } from '../../../shared/types';

export function SettingsSheet({
  open,
  settings,
  debugEnabled,
  onOpenChange,
  onSaved,
  onDebugEnabledChange,
  onError,
  onStatus
}: {
  open: boolean;
  settings: PublicLlmSettings | null;
  debugEnabled: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (settings: PublicLlmSettings) => void;
  onDebugEnabledChange: (enabled: boolean) => void;
  onError: (message: string) => void;
  onStatus: (message: string) => void;
}) {
  const [provider, setProvider] = useState<LlmProviderKind>('openai-compatible');
  const [baseURL, setBaseURL] = useState('https://api.openai.com/v1');
  const [model, setModel] = useState('gpt-5');
  const [apiKey, setApiKey] = useState('');
  const [embeddingProvider, setEmbeddingProvider] = useState<LlmProviderKind>('openai-compatible');
  const [embeddingBaseURL, setEmbeddingBaseURL] = useState('https://api.openai.com/v1');
  const [embeddingModel, setEmbeddingModel] = useState('text-embedding-3-small');
  const [embeddingApiKey, setEmbeddingApiKey] = useState('');
  const [visionProvider, setVisionProvider] = useState<LlmProviderKind>('openai-compatible');
  const [visionBaseURL, setVisionBaseURL] = useState('https://api.openai.com/v1');
  const [visionModel, setVisionModel] = useState('gpt-5');
  const [visionApiKey, setVisionApiKey] = useState('');

  useEffect(() => {
    if (!settings) {
      return;
    }
    setProvider(settings.chat.provider);
    setBaseURL(settings.chat.baseURL);
    setModel(settings.chat.model);
    setApiKey('');
    setEmbeddingProvider(settings.embedding.provider);
    setEmbeddingBaseURL(settings.embedding.baseURL);
    setEmbeddingModel(settings.embedding.model);
    setEmbeddingApiKey('');
    setVisionProvider(settings.vision.provider);
    setVisionBaseURL(settings.vision.baseURL);
    setVisionModel(settings.vision.model);
    setVisionApiKey('');
  }, [settings, open]);

  function updateProvider(nextProvider: LlmProviderKind) {
    setProvider(nextProvider);
    if (nextProvider === 'anthropic-compatible' && baseURL === 'https://api.openai.com/v1') {
      setBaseURL('https://api.anthropic.com/v1');
      setModel('claude-sonnet-4-5');
    }
    if (nextProvider === 'openai-compatible' && baseURL === 'https://api.anthropic.com/v1') {
      setBaseURL('https://api.openai.com/v1');
      setModel('gpt-5');
    }
  }

  async function saveSettings() {
    try {
      const next = await getApi().updateLlmSettings({
        provider,
        baseURL,
        model,
        apiKey: apiKey.trim() ? apiKey : undefined,
        embeddingProvider,
        embeddingBaseURL,
        embeddingModel,
        embeddingApiKey: embeddingApiKey.trim() ? embeddingApiKey : undefined,
        visionProvider,
        visionBaseURL,
        visionModel,
        visionApiKey: visionApiKey.trim() ? visionApiKey : undefined
      });
      onSaved(next);
      setApiKey('');
      setEmbeddingApiKey('');
      setVisionApiKey('');
      onStatus('LLM settings saved.');
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Settings</SheetTitle>
        </SheetHeader>
        <div className="settings-form">
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>LLM</h2>
                <p className="muted">{settings?.chat.hasApiKey ? 'API key saved' : 'API key missing'}</p>
              </div>
            </div>
            <label className="field-label">
              Provider
              <Select value={provider} onValueChange={(value) => updateProvider(value as LlmProviderKind)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="openai-compatible">OpenAI compatible</SelectItem>
                  <SelectItem value="anthropic-compatible">Anthropic compatible</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label className="field-label">
              URL
              <Input value={baseURL} onChange={(event) => setBaseURL(event.target.value)} />
            </label>
            <label className="field-label">
              Model
              <Input value={model} onChange={(event) => setModel(event.target.value)} />
            </label>
            <label className="field-label">
              API Key
              <Input
                value={apiKey}
                type="password"
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={settings?.chat.hasApiKey ? 'Stored; enter a new key to replace' : 'API key'}
              />
            </label>
            <div className="settings-subsection">
              <h3>Embedding</h3>
              <p className="muted">{settings?.embedding.hasApiKey ? 'API key saved' : 'API key missing'}</p>
            </div>
            <label className="field-label">
              Provider
              <Select value={embeddingProvider} onValueChange={(value) => setEmbeddingProvider(value as LlmProviderKind)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="openai-compatible">OpenAI compatible</SelectItem>
                  <SelectItem value="anthropic-compatible">Anthropic compatible</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label className="field-label">
              URL
              <Input value={embeddingBaseURL} onChange={(event) => setEmbeddingBaseURL(event.target.value)} />
            </label>
            <label className="field-label">
              Model
              <Input value={embeddingModel} onChange={(event) => setEmbeddingModel(event.target.value)} />
            </label>
            <label className="field-label">
              API Key
              <Input
                value={embeddingApiKey}
                type="password"
                onChange={(event) => setEmbeddingApiKey(event.target.value)}
                placeholder={settings?.embedding.hasApiKey ? 'Stored; enter a new key to replace' : 'API key'}
              />
            </label>
            <div className="settings-subsection">
              <h3>Vision</h3>
              <p className="muted">Configured for later image support</p>
            </div>
            <label className="field-label">
              Provider
              <Select value={visionProvider} onValueChange={(value) => setVisionProvider(value as LlmProviderKind)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="openai-compatible">OpenAI compatible</SelectItem>
                  <SelectItem value="anthropic-compatible">Anthropic compatible</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label className="field-label">
              URL
              <Input value={visionBaseURL} onChange={(event) => setVisionBaseURL(event.target.value)} />
            </label>
            <label className="field-label">
              Model
              <Input value={visionModel} onChange={(event) => setVisionModel(event.target.value)} />
            </label>
            <label className="field-label">
              API Key
              <Input
                value={visionApiKey}
                type="password"
                onChange={(event) => setVisionApiKey(event.target.value)}
                placeholder={settings?.vision.hasApiKey ? 'Stored; enter a new key to replace' : 'API key'}
              />
            </label>
            <div className="settings-subsection">
              <h3>Debug</h3>
              <p className="muted">Expose internal indexing details for this session.</p>
            </div>
            <label className="settings-debug-toggle">
              <input
                type="checkbox"
                checked={debugEnabled}
                onChange={(event) => onDebugEnabledChange(event.target.checked)}
              />
              <span>
                <Bug />
                Show debug details
              </span>
            </label>
            <div className="button-row">
              <Button
                size="sm"
                onClick={() => void saveSettings()}
                disabled={!baseURL.trim() || !model.trim() || !embeddingBaseURL.trim() || !embeddingModel.trim()}
              >
                <Save />
                Save
              </Button>
            </div>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
