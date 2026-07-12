import { Agent, type AgentTool } from '@earendil-works/pi-agent-core';
import type { Model, Models } from '@earendil-works/pi-ai';
import { Type } from 'typebox';
import type { ValidationDiagnosticCode } from '../../shared/provider-settings.js';

export type HarnessValidation = {
  status: 'succeeded' | 'failed' | 'unknown';
  diagnosticCode: ValidationDiagnosticCode;
  safeMessage: string;
};
export async function validateHarness(
  models: Models,
  model: Model<'openai-completions'>,
  options: { timeoutMs?: number; nonce?: string } = {},
): Promise<HarnessValidation> {
  const nonce = options.nonce ?? crypto.randomUUID();
  let called = false;
  let final = false;
  let turns = 0;
  const tool: AgentTool = {
    name: 'confirm_writellm_probe',
    label: 'Confirm probe',
    description: 'Confirm harness tool support using the exact nonce.',
    parameters: Type.Object({ nonce: Type.Literal(nonce) }, { additionalProperties: false }),
    execute: async (_id, args) => {
      if ((args as { nonce?: unknown }).nonce !== nonce) throw new Error('invalid-probe-arguments');
      called = true;
      return {
        content: [{ type: 'text', text: 'Probe confirmed. Finish with a short final response.' }],
        details: {},
      };
    },
  };
  const agent = new Agent({
    initialState: {
      model,
      thinkingLevel: 'off',
      systemPrompt:
        'You are a compatibility probe. Call confirm_writellm_probe exactly once with the supplied nonce, then after its result provide a final response.',
      tools: [tool],
    },
    streamFn: (m, c, o) =>
      models.streamSimple(m, c, {
        ...o,
        timeoutMs: options.timeoutMs ?? 30_000,
        maxRetries: 0,
        maxTokens: Math.min(m.maxTokens, 128),
      }),
    toolExecution: 'sequential',
  });
  agent.subscribe((event) => {
    if (event.type === 'turn_end') {
      turns++;
      const message = event.message;
      const calls =
        message.role === 'assistant'
          ? message.content.filter((part) => part.type === 'toolCall')
          : [];
      if (called && calls.length === 0 && !(message.role === 'assistant' && message.errorMessage))
        final = true;
      if (turns >= 2 && !final) agent.abort();
    }
  });
  const timer = setTimeout(() => agent.abort(), options.timeoutMs ?? 30_000);
  try {
    await agent.prompt(`Run the required compatibility probe. Nonce: ${nonce}`);
  } finally {
    clearTimeout(timer);
  }
  if (called && final)
    return {
      status: 'succeeded',
      diagnosticCode: 'VALIDATION_OK',
      safeMessage: 'The provider completed the required agent tool loop.',
    };
  const error = agent.state.errorMessage?.toLowerCase() ?? '';
  if (error.includes('401') || error.includes('403') || error.includes('unauthorized'))
    return failed(
      'VALIDATION_AUTH_REJECTED',
      'Authentication was rejected. Replace the API key and retry.',
    );
  if (error.includes('429'))
    return failed('VALIDATION_RATE_LIMITED', 'The provider is rate limited. Wait and retry.');
  if (error.includes('404') || error.includes('422'))
    return failed(
      'VALIDATION_MODEL_REJECTED',
      'The endpoint or model was rejected. Review the saved settings.',
    );
  if (error.includes('abort') || error.includes('timeout'))
    return failed(
      'VALIDATION_TIMEOUT',
      'Validation timed out. Retry when the service is available.',
    );
  if (!called && !error)
    return failed(
      'VALIDATION_TOOLS_UNSUPPORTED',
      'The model did not produce the required tool call.',
    );
  return {
    status: 'unknown',
    diagnosticCode: 'VALIDATION_UNKNOWN',
    safeMessage:
      'The provider could not complete the compatibility check. Review settings and retry.',
  };
}
const failed = (
  diagnosticCode: ValidationDiagnosticCode,
  safeMessage: string,
): HarnessValidation => ({ status: 'failed', diagnosticCode, safeMessage });
