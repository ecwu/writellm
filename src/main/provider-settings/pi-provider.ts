import { createModels, createProvider, type Model, type Models } from '@earendil-works/pi-ai';
import * as openAICompletions from '@earendil-works/pi-ai/api/openai-completions';
import { deriveHarnessProfile, type ProviderConfig } from '../../shared/provider-settings.js';

export function createProviderRuntime(config:ProviderConfig, secret:string): {models:Models; model:Model<'openai-completions'>} {
  const profile=deriveHarnessProfile(config);
  const model:Model<'openai-completions'>={ ...profile, provider:profile.providerId, input:['text'], cost:{input:0,output:0,cacheRead:0,cacheWrite:0}, compat:{supportsStore:false,supportsDeveloperRole:false,supportsReasoningEffort:false,supportsUsageInStreaming:true,maxTokensField:'max_tokens',requiresToolResultName:true,requiresAssistantAfterToolResult:false,requiresThinkingAsText:true} };
  const provider=createProvider({ id:profile.providerId, name:'WriteLLM custom provider', baseUrl:profile.baseUrl, models:[model], auth:{apiKey:{name:'API key',resolve:async()=>({auth:{apiKey:secret},source:'Stored'})}}, api:openAICompletions });
  const models=createModels(); models.setProvider(provider);
  return {models,model};
}
