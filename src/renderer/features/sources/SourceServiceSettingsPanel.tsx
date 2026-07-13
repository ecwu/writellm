import { useEffect, useReducer } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormField } from '@/components/patterns/FormField';
import { StatusNotice } from '@/components/patterns/StatusNotice';
import type { ServiceProvider, SourceServicesApi } from '../../../shared/sources';
import {
  createSourceServiceFormState,
  sourceServiceErrorMessage,
  sourceServiceFormReducer,
} from './source-service-settings-state';

export function SourceServiceSettingsPanel({
  api = window.writellmSourceServices,
}: {
  api?: SourceServicesApi;
}) {
  const [mineru, dispatchMineru] = useReducer(
    sourceServiceFormReducer,
    'mineru',
    createSourceServiceFormState,
  );
  const [siliconflow, dispatchSiliconflow] = useReducer(
    sourceServiceFormReducer,
    'siliconflow',
    createSourceServiceFormState,
  );
  useEffect(() => {
    let current = true;
    void api.getServiceStatus().then((result) => {
      if (!current) return;
      if (result.status === 'ok') {
        dispatchMineru({ type: 'loaded', summary: result.mineru });
        dispatchSiliconflow({ type: 'loaded', summary: result.siliconflow });
      } else {
        dispatchMineru({ type: 'failure', error: result.error });
        dispatchSiliconflow({ type: 'failure', error: result.error });
      }
    });
    return () => {
      current = false;
      dispatchMineru({ type: 'clear' });
      dispatchSiliconflow({ type: 'clear' });
    };
  }, [api]);
  return (
    <section className="grid gap-4" aria-labelledby="source-service-settings-title">
      <header>
        <h2 id="source-service-settings-title">Knowledge processing services</h2>
        <p>
          Application-wide credentials for PDF parsing and block indexing. Saved keys are never
          shown again or copied into projects.
        </p>
      </header>
      <ServiceForm api={api} state={mineru} dispatch={dispatchMineru} />
      <ServiceForm api={api} state={siliconflow} dispatch={dispatchSiliconflow} />
    </section>
  );
}

function ServiceForm({
  api,
  state,
  dispatch,
}: {
  api: SourceServicesApi;
  state: ReturnType<typeof createSourceServiceFormState>;
  dispatch: React.Dispatch<Parameters<typeof sourceServiceFormReducer>[1]>;
}) {
  const label = state.provider === 'mineru' ? 'MinerU PDF parsing' : 'SiliconFlow indexing';
  const call = async (operation: 'save' | 'remove' | 'validate') => {
    const revision = state.summary?.revision;
    dispatch({
      type: 'start',
      operation:
        operation === 'save' ? 'saving' : operation === 'remove' ? 'removing' : 'validating',
    });
    const result =
      operation === 'save'
        ? await (state.provider === 'mineru'
            ? api.saveMinerUCredential
            : api.saveSiliconFlowCredential)({
            expectedRevision: revision ?? null,
            credential: state.credential,
          })
        : operation === 'remove'
          ? await (state.provider === 'mineru'
              ? api.removeMinerUCredential
              : api.removeSiliconFlowCredential)({ expectedRevision: revision! })
          : await (state.provider === 'mineru'
              ? api.validateMinerUCredential
              : api.validateSiliconFlowCredential)({ expectedRevision: revision! });
    if (
      result.status === 'saved' ||
      result.status === 'removed' ||
      result.status === 'completed' ||
      result.status === 'stale'
    )
      dispatch({ type: 'success', summary: result.summary });
    else if (result.status === 'conflict')
      dispatch({ type: 'loaded', summary: result.currentSummary });
    else if (result.status === 'error')
      dispatch({ type: 'failure', error: result.error, summary: result.currentSummary });
  };
  return (
    <section
      className="grid gap-3 bg-card p-4"
      aria-labelledby={`${state.provider}-settings-title`}
    >
      <h3 id={`${state.provider}-settings-title`}>{label}</h3>
      {state.error && (
        <StatusNotice tone="error">{sourceServiceErrorMessage(state.error)}</StatusNotice>
      )}
      {state.summary && (
        <StatusNotice
          tone={
            state.summary.available
              ? 'success'
              : state.summary.validation.status === 'failed'
                ? 'warning'
                : 'info'
          }
        >
          {state.summary.available
            ? 'Configured and validated.'
            : state.summary.configured
              ? 'Credential saved. Validation is pending or failed.'
              : 'Not configured.'}
        </StatusNotice>
      )}
      <FormField
        label={state.summary?.configured ? 'Replacement credential (optional)' : 'Credential'}
        description="Write-only: this value is cleared after save or when Settings closes."
      >
        <Input
          type="password"
          autoComplete="new-password"
          value={state.credential}
          onChange={(event) => dispatch({ type: 'credential.change', value: event.target.value })}
        />
      </FormField>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          busy={state.phase === 'saving'}
          disabled={!state.credential.trim() || !['ready', 'error'].includes(state.phase)}
          onClick={() => void call('save')}
        >
          {state.summary?.configured ? 'Replace credential' : 'Save credential'}
        </Button>
        <Button
          type="button"
          variant="secondary"
          busy={state.phase === 'validating'}
          disabled={!state.summary?.revision || !state.summary.configured}
          onClick={() => void call('validate')}
        >
          Validate
        </Button>
        <Button
          type="button"
          variant="destructive"
          busy={state.phase === 'removing'}
          disabled={!state.summary?.revision || !state.summary.configured}
          onClick={() => void call('remove')}
        >
          Remove credential
        </Button>
      </div>
    </section>
  );
}
