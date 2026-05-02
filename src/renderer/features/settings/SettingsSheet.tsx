
import { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
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
  onOpenChange,
  onSaved,
  onError,
  onStatus
}: {
  open: boolean;
  settings: PublicLlmSettings | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (settings: PublicLlmSettings) => void;
  onError: (message: string) => void;
  onStatus: (message: string) => void;
}) {
  const [provider, setProvider] = useState<LlmProviderKind>('openai-compatible');
  const [baseURL, setBaseURL] = useState('https://api.openai.com/v1');
  const [model, setModel] = useState('gpt-5');
  const [apiKey, setApiKey] = useState('');

  useEffect(() => {
    if (!settings) {
      return;
    }
    setProvider(settings.provider);
    setBaseURL(settings.baseURL);
    setModel(settings.model);
    setApiKey('');
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
        apiKey: apiKey.trim() ? apiKey : undefined
      });
      onSaved(next);
      setApiKey('');
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
            <div className="artifact-heading">
              <div>
                <h2>LLM</h2>
                <p className="muted">{settings?.hasApiKey ? 'API key saved' : 'API key missing'}</p>
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
                placeholder={settings?.hasApiKey ? 'Stored; enter a new key to replace' : 'API key'}
              />
            </label>
            <div className="button-row">
              <Button size="sm" onClick={() => void saveSettings()} disabled={!baseURL.trim() || !model.trim()}>
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
