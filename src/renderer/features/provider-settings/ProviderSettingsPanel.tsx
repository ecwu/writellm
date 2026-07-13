import { useEffect, useState } from 'react';
import { FormField } from '@/components/patterns/FormField';
import { StatusNotice } from '@/components/patterns/StatusNotice';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type {
  ProviderError,
  ProviderSettingsIpc,
  ProviderSummary,
} from '../../../shared/provider-settings';
import { draftFromSummary, emptyDraft, fieldErrors } from './provider-settings-state';
export function ProviderSettingsPanel({
  api = window.writellmProviderSettings,
}: {
  api?: ProviderSettingsIpc;
}) {
  const [summary, setSummary] = useState<ProviderSummary | null>(null),
    [draft, setDraft] = useState(emptyDraft),
    [error, setError] = useState<ProviderError>(),
    [busy, setBusy] = useState(false),
    [removeOpen, setRemoveOpen] = useState(false),
    [consent, setConsent] = useState(false);
  const errors = fieldErrors(error);
  useEffect(() => {
    void api.getProviderSummary().then((r) => {
      if (r.status === 'ok') {
        setSummary(r.summary);
        setDraft(draftFromSummary(r.summary));
      } else setError(r.error);
    });
    return () => setDraft((d) => ({ ...d, secret: '' }));
  }, [api]);
  const save = async () => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    const result = await api.saveProviderSettings({
      expectedRevision: summary?.revision ?? null,
      config: {
        providerKind: 'openai-compatible',
        baseUrl: draft.baseUrl,
        modelId: draft.modelId,
        contextWindow: Number(draft.contextWindow),
        maxOutputTokens: Number(draft.maxOutputTokens),
        reasoning: draft.reasoning,
      },
      ...(draft.secret
        ? { secret: draft.secret }
        : summary?.secretState === 'configured'
          ? { reuseSavedSecret: true }
          : { secret: '' }),
    });
    setBusy(false);
    if (result.status === 'saved') {
      setSummary(result.summary);
      setDraft(draftFromSummary(result.summary));
    } else if (result.status === 'error') {
      setError(result.error);
      if (result.currentSummary) setSummary(result.currentSummary);
    }
  };
  const replace = async () => {
    if (!summary?.revision || !draft.secret) return;
    setBusy(true);
    const r = await api.replaceProviderSecret({
      expectedRevision: summary.revision,
      secret: draft.secret,
    });
    setBusy(false);
    if (r.status === 'saved') {
      setSummary(r.summary);
      setDraft(draftFromSummary(r.summary));
    } else if (r.status === 'error') setError(r.error);
  };
  const remove = async () => {
    if (!summary?.revision) return;
    setBusy(true);
    const r = await api.removeProviderSecret({ expectedRevision: summary.revision });
    setBusy(false);
    setRemoveOpen(false);
    if (r.status === 'removed') {
      setSummary(r.summary);
      setDraft(draftFromSummary(r.summary));
    } else if (r.status === 'error') setError(r.error);
  };
  const validate = async () => {
    if (!summary?.revision) return;
    setConsent(false);
    setBusy(true);
    setSummary({ ...summary, validation: { status: 'validating' }, available: false });
    const r = await api.validateProvider({ expectedRevision: summary.revision });
    setBusy(false);
    if (r.status === 'completed' || r.status === 'stale') setSummary(r.summary);
    else if (r.status === 'error') {
      setError(r.error);
      if (r.currentSummary) setSummary(r.currentSummary);
    }
  };
  const set = <K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));
  return (
    <section className="grid w-full max-w-2xl gap-4" aria-labelledby="provider-settings-title">
      <header>
        <h2 id="provider-settings-title">AI provider</h2>
        <p>Configure the application-wide Pi Agent provider. Keys never enter project files.</p>
      </header>
      {error && <StatusNotice tone="error">{error.message}</StatusNotice>}
      {summary && (
        <StatusNotice
          tone={
            summary.available
              ? 'success'
              : summary.validation.status === 'failed'
                ? 'warning'
                : 'info'
          }
        >
          {summary.available
            ? 'Ready for AI tools.'
            : (summary.validation.safeMessage ??
              `API key: ${summary.secretState.replace('-', ' ')}`)}
        </StatusNotice>
      )}
      <form
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <FormField label="Endpoint URL" error={errors.baseUrl}>
          <Input
            value={draft.baseUrl}
            onChange={(e) => set('baseUrl', e.target.value)}
            placeholder="https://api.example.com/v1/"
          />
        </FormField>
        <FormField label="Model" error={errors.model}>
          <Input value={draft.modelId} onChange={(e) => set('modelId', e.target.value)} />
        </FormField>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Context window">
            <Input
              type="number"
              min={1024}
              value={draft.contextWindow}
              onChange={(e) => set('contextWindow', Number(e.target.value))}
            />
          </FormField>
          <FormField label="Maximum output tokens">
            <Input
              type="number"
              min={1}
              value={draft.maxOutputTokens}
              onChange={(e) => set('maxOutputTokens', Number(e.target.value))}
            />
          </FormField>
        </div>
        <Label className="flex items-center gap-2">
          <Checkbox
            checked={draft.reasoning}
            onCheckedChange={(checked) => set('reasoning', checked)}
          />
          Model supports reasoning
        </Label>
        <FormField
          label={
            summary?.secretState === 'configured' ? 'Replacement API key (optional)' : 'API key'
          }
          error={errors.secret}
          description="The saved key is protected by the operating system and is never shown again."
        >
          <Input
            type="password"
            autoComplete="new-password"
            value={draft.secret}
            onChange={(e) => set('secret', e.target.value)}
          />
        </FormField>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy}>
            {summary?.config ? 'Save changes' : 'Save provider'}
          </Button>
          {summary?.secretState === 'configured' && draft.secret && (
            <Button type="button" disabled={busy} onClick={() => void replace()}>
              Replace key
            </Button>
          )}
          {summary?.secretState === 'configured' && (
            <Button type="button" disabled={busy} onClick={() => setRemoveOpen(true)}>
              Remove key
            </Button>
          )}
          {summary?.config && summary.secretState === 'configured' && (
            <Button type="button" disabled={busy} onClick={() => setConsent(true)}>
              Validate provider
            </Button>
          )}
        </div>
      </form>
      {summary?.harnessProfile && (
        <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-2 break-words [&_dt]:font-medium [&_dd]:m-0">
          <dt>API</dt>
          <dd>{summary.harnessProfile.api}</dd>
          <dt>Model</dt>
          <dd>{summary.harnessProfile.id}</dd>
          <dt>Capacity</dt>
          <dd>
            {summary.harnessProfile.contextWindow.toLocaleString()} /{' '}
            {summary.harnessProfile.maxTokens.toLocaleString()} output
          </dd>
        </dl>
      )}
      <Dialog
        open={removeOpen}
        onOpenChange={(o) => {
          if (!busy) setRemoveOpen(o);
        }}
      >
        <DialogContent>
          <DialogTitle>Remove API key?</DialogTitle>
          <DialogDescription>
            AI validation and later AI tools will be unavailable until a new key is saved.
          </DialogDescription>
          <Button autoFocus disabled={busy} onClick={() => void remove()}>
            Remove key
          </Button>
          <Button disabled={busy} onClick={() => setRemoveOpen(false)}>
            Cancel
          </Button>
        </DialogContent>
      </Dialog>
      <Dialog open={consent} onOpenChange={setConsent}>
        <DialogContent>
          <DialogTitle>Validate this provider?</DialogTitle>
          <DialogDescription>
            This runs a minimal Pi Agent tool loop and may use a small number of tokens.
          </DialogDescription>
          <Button autoFocus disabled={busy} onClick={() => void validate()}>
            Run validation
          </Button>
          <Button disabled={busy} onClick={() => setConsent(false)}>
            Cancel
          </Button>
        </DialogContent>
      </Dialog>
    </section>
  );
}
