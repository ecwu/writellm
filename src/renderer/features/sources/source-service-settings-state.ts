import type { ServiceProvider, SourceError, SourceServiceSummary } from '../../../shared/sources';
export type SourceServiceFormState = {
  provider: ServiceProvider;
  summary: SourceServiceSummary | null;
  credential: string;
  phase: 'loading' | 'ready' | 'saving' | 'validating' | 'removing' | 'error';
  error: SourceError | null;
};
export const createSourceServiceFormState = (
  provider: ServiceProvider,
): SourceServiceFormState => ({
  provider,
  summary: null,
  credential: '',
  phase: 'loading',
  error: null,
});

export function sourceServiceErrorMessage(error: SourceError): string {
  switch (error.code) {
    case 'SOURCE_MINERU_AUTH':
    case 'SOURCE_SILICONFLOW_AUTH':
      return 'Authentication failed. Check the credential and try again.';
    case 'SOURCE_MINERU_RATE_LIMITED':
    case 'SOURCE_SILICONFLOW_RATE_LIMITED':
      return 'The service is rate limiting requests. Wait a moment and try again.';
    case 'SOURCE_MINERU_TEMPORARY':
    case 'SOURCE_SILICONFLOW_TEMPORARY':
      return 'The service could not be reached or timed out. Check your connection and try again.';
    case 'SOURCE_MINERU_REJECTED':
    case 'SOURCE_INDEX_FAILED':
      return 'The service rejected the validation request. Review the credential and try again.';
    case 'SOURCE_MINERU_NOT_CONFIGURED':
    case 'SOURCE_SILICONFLOW_NOT_CONFIGURED':
      return 'The saved credential is unavailable. Replace it and try again.';
    case 'SOURCE_CONFLICT':
      return 'This setting changed elsewhere. Review the current value and try again.';
    case 'SOURCE_STORAGE_UNAVAILABLE':
      return 'Secure credential storage is unavailable. Check the system keychain and try again.';
    default:
      return 'This service setting could not be updated safely. Review it and try again.';
  }
}
export function sourceServiceFormReducer(
  state: SourceServiceFormState,
  event:
    | { type: 'loaded'; summary: SourceServiceSummary }
    | { type: 'credential.change'; value: string }
    | { type: 'start'; operation: 'saving' | 'validating' | 'removing' }
    | { type: 'success'; summary: SourceServiceSummary }
    | { type: 'failure'; error: SourceError; summary?: SourceServiceSummary }
    | { type: 'clear' },
): SourceServiceFormState {
  switch (event.type) {
    case 'loaded':
      return { ...state, summary: event.summary, credential: '', phase: 'ready', error: null };
    case 'credential.change':
      return { ...state, credential: event.value, error: null };
    case 'start':
      return { ...state, phase: event.operation, error: null };
    case 'success':
      return { ...state, summary: event.summary, credential: '', phase: 'ready', error: null };
    case 'failure':
      return {
        ...state,
        summary: event.summary ?? state.summary,
        phase: 'error',
        error: event.error,
      };
    case 'clear':
      return { ...state, credential: '', error: null, phase: state.summary ? 'ready' : 'loading' };
  }
}
