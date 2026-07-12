export const providerSettingsChannels = {
  get: 'writellm:provider-settings:get',
  save: 'writellm:provider-settings:save',
  replaceSecret: 'writellm:provider-settings:replace-secret',
  removeSecret: 'writellm:provider-settings:remove-secret',
  validate: 'writellm:provider-settings:validate',
} as const;

export type ProviderConfig = {
  providerKind: 'openai-compatible';
  baseUrl: string;
  modelId: string;
  contextWindow: number;
  maxOutputTokens: number;
  reasoning: boolean;
};
export type HarnessModelProfileV1 = {
  profileVersion: 1;
  providerId: 'writellm-custom';
  api: 'openai-completions';
  id: string;
  name: string;
  baseUrl: string;
  reasoning: boolean;
  input: readonly ['text'];
  contextWindow: number;
  maxTokens: number;
};
export type ValidationDiagnosticCode =
  | 'VALIDATION_OK'
  | 'VALIDATION_AUTH_REJECTED'
  | 'VALIDATION_MODEL_REJECTED'
  | 'VALIDATION_RATE_LIMITED'
  | 'VALIDATION_SERVICE_REJECTED'
  | 'VALIDATION_UNREACHABLE'
  | 'VALIDATION_TIMEOUT'
  | 'VALIDATION_RESPONSE_INVALID'
  | 'VALIDATION_TOOLS_UNSUPPORTED'
  | 'VALIDATION_TOOL_ARGUMENTS_INVALID'
  | 'VALIDATION_TOOL_RESULT_UNUSABLE'
  | 'VALIDATION_LOOP_INCOMPLETE'
  | 'VALIDATION_CANCELED'
  | 'VALIDATION_STALE'
  | 'VALIDATION_UNKNOWN';
export type ValidationSummary = {
  status: 'not-run' | 'validating' | 'succeeded' | 'failed' | 'unknown' | 'stale';
  completedAt?: string;
  diagnosticCode?: ValidationDiagnosticCode;
  safeMessage?: string;
};
export type ProviderSummary = {
  revision: string | null;
  config: ProviderConfig | null;
  harnessProfile: HarnessModelProfileV1 | null;
  secretState: 'not-configured' | 'configured' | 'unavailable' | 'invalid';
  validation: ValidationSummary;
  available: boolean;
  warning?: string;
};
export type ProviderErrorCode =
  | 'PROVIDER_INVALID_INPUT'
  | 'PROVIDER_INSECURE_ENDPOINT'
  | 'PROVIDER_CONFLICT'
  | 'PROVIDER_SECRET_REQUIRED'
  | 'PROVIDER_SECRET_STORAGE_UNAVAILABLE'
  | 'PROVIDER_SECRET_INVALID'
  | 'PROVIDER_STORAGE_UNAVAILABLE'
  | 'PROVIDER_NOT_READY'
  | 'PROVIDER_VALIDATION_IN_PROGRESS'
  | 'PROVIDER_UNAUTHORIZED_SENDER'
  | 'PROVIDER_INTERNAL';
export type ProviderError = {
  code: ProviderErrorCode;
  message: string;
  field?: 'baseUrl' | 'model' | 'secret';
  issue?: string;
};
export type SaveProviderSettingsInput = {
  expectedRevision: string | null;
  config: ProviderConfig;
} & ({ secret: string; reuseSavedSecret?: never } | { secret?: never; reuseSavedSecret: true });
export type ReplaceProviderSecretInput = { expectedRevision: string; secret: string };
export type RemoveProviderSecretInput = { expectedRevision: string };
export type ValidateProviderInput = { expectedRevision: string };
export type GetProviderSummaryResult =
  | { status: 'ok'; summary: ProviderSummary }
  | { status: 'error'; error: ProviderError };
export type ProviderMutationResult =
  | { status: 'saved' | 'removed'; summary: ProviderSummary }
  | { status: 'error'; error: ProviderError; currentSummary?: ProviderSummary };
export type ValidateProviderResult =
  | { status: 'completed' | 'stale'; summary: ProviderSummary }
  | { status: 'error'; error: ProviderError; currentSummary?: ProviderSummary };
export type ProviderSettingsIpc = {
  getProviderSummary(): Promise<GetProviderSummaryResult>;
  saveProviderSettings(input: SaveProviderSettingsInput): Promise<ProviderMutationResult>;
  replaceProviderSecret(input: ReplaceProviderSecretInput): Promise<ProviderMutationResult>;
  removeProviderSecret(input: RemoveProviderSecretInput): Promise<ProviderMutationResult>;
  validateProvider(input: ValidateProviderInput): Promise<ValidateProviderResult>;
};

const exact = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).every((key) => keys.includes(key));
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const revision = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 128;
export function parseProviderConfig(value: unknown): ProviderConfig | ProviderError {
  if (
    !record(value) ||
    !exact(value, [
      'providerKind',
      'baseUrl',
      'modelId',
      'contextWindow',
      'maxOutputTokens',
      'reasoning',
    ])
  )
    return invalid();
  if (value.providerKind !== 'openai-compatible') return invalid();
  if (typeof value.baseUrl !== 'string' || value.baseUrl.length < 1 || value.baseUrl.length > 2048)
    return invalid('baseUrl');
  let url: URL;
  try {
    url = new URL(value.baseUrl);
  } catch {
    return invalid('baseUrl');
  }
  const loopback =
    url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  if (
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    return {
      code: 'PROVIDER_INSECURE_ENDPOINT',
      message: 'Use HTTPS for remote endpoints; HTTP is allowed only for loopback.',
      field: 'baseUrl',
    };
  const modelId = typeof value.modelId === 'string' ? value.modelId.trim() : '';
  if (!modelId || modelId.length > 256 || hasControlCharacters(modelId)) return invalid('model');
  if (
    !Number.isInteger(value.contextWindow) ||
    (value.contextWindow as number) < 1024 ||
    (value.contextWindow as number) > 2_000_000
  )
    return invalid();
  if (
    !Number.isInteger(value.maxOutputTokens) ||
    (value.maxOutputTokens as number) < 1 ||
    (value.maxOutputTokens as number) > (value.contextWindow as number)
  )
    return invalid();
  if (typeof value.reasoning !== 'boolean') return invalid();
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return {
    providerKind: 'openai-compatible',
    baseUrl: url.toString(),
    modelId,
    contextWindow: value.contextWindow as number,
    maxOutputTokens: value.maxOutputTokens as number,
    reasoning: value.reasoning,
  };
}
function invalid(field?: ProviderError['field']): ProviderError {
  return {
    code: 'PROVIDER_INVALID_INPUT',
    message: 'Correct the highlighted provider settings.',
    field,
  };
}
export function validateSecret(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= 4096 &&
    !/^\s+$/.test(value) &&
    !hasControlCharacters(value)
  );
}
function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
}
export function deriveHarnessProfile(config: ProviderConfig): HarnessModelProfileV1 {
  return {
    profileVersion: 1,
    providerId: 'writellm-custom',
    api: 'openai-completions',
    id: config.modelId,
    name: config.modelId,
    baseUrl: config.baseUrl,
    reasoning: config.reasoning,
    input: ['text'],
    contextWindow: config.contextWindow,
    maxTokens: config.maxOutputTokens,
  };
}
export function isAvailable(summary: ProviderSummary): boolean {
  return (
    summary.secretState === 'configured' &&
    summary.validation.status === 'succeeded' &&
    summary.config !== null
  );
}
export function parseSaveInput(value: unknown): SaveProviderSettingsInput | ProviderError {
  if (!record(value) || !exact(value, ['expectedRevision', 'config', 'secret', 'reuseSavedSecret']))
    return invalid();
  if (value.expectedRevision !== null && !revision(value.expectedRevision)) return invalid();
  const config = parseProviderConfig(value.config);
  if ('code' in config) return config;
  const hasSecret = Object.hasOwn(value, 'secret');
  const reuse = value.reuseSavedSecret === true;
  if (hasSecret === reuse || (hasSecret && !validateSecret(value.secret)))
    return { code: 'PROVIDER_SECRET_REQUIRED', message: 'Enter a valid API key.', field: 'secret' };
  return hasSecret
    ? {
        expectedRevision: value.expectedRevision as string | null,
        config,
        secret: value.secret as string,
      }
    : { expectedRevision: value.expectedRevision as string | null, config, reuseSavedSecret: true };
}
export function parseRevisionInput(value: unknown): { expectedRevision: string } | ProviderError {
  return record(value) && exact(value, ['expectedRevision']) && revision(value.expectedRevision)
    ? { expectedRevision: value.expectedRevision }
    : invalid();
}
export function parseReplaceInput(value: unknown): ReplaceProviderSecretInput | ProviderError {
  return record(value) &&
    exact(value, ['expectedRevision', 'secret']) &&
    revision(value.expectedRevision) &&
    validateSecret(value.secret)
    ? { expectedRevision: value.expectedRevision, secret: value.secret }
    : invalid('secret');
}
export const providerErrorMessages: Record<ProviderErrorCode, string> = {
  PROVIDER_INVALID_INPUT: 'Correct the highlighted provider settings.',
  PROVIDER_INSECURE_ENDPOINT: 'Use HTTPS for remote endpoints.',
  PROVIDER_CONFLICT: 'Settings changed. Reload and review before retrying.',
  PROVIDER_SECRET_REQUIRED: 'Enter or preserve a configured API key.',
  PROVIDER_SECRET_STORAGE_UNAVAILABLE:
    'Secure storage is unavailable. Unlock or configure the operating system secret service and retry.',
  PROVIDER_SECRET_INVALID: 'The saved key cannot be decrypted. Replace or remove it.',
  PROVIDER_STORAGE_UNAVAILABLE:
    'Settings could not be saved. Your previous settings remain current.',
  PROVIDER_NOT_READY: 'Complete and save the provider settings and API key first.',
  PROVIDER_VALIDATION_IN_PROGRESS: 'Validation is already running for these settings.',
  PROVIDER_UNAUTHORIZED_SENDER: 'This request was not authorized.',
  PROVIDER_INTERNAL: 'The provider operation could not be completed. Retry or restart the app.',
};
