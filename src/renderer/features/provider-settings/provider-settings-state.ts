import type { ProviderConfig, ProviderError, ProviderSummary } from '../../../shared/provider-settings';
export type ProviderDraft=ProviderConfig&{secret:string};
export const emptyDraft:ProviderDraft={providerKind:'openai-compatible',baseUrl:'',modelId:'',contextWindow:128000,maxOutputTokens:4096,reasoning:false,secret:''};
export function draftFromSummary(summary:ProviderSummary):ProviderDraft{return summary.config?{...summary.config,secret:''}:emptyDraft;}
export function fieldErrors(error?:ProviderError){return error?.field?{[error.field]:error.message}:{};}
