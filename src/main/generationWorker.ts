import type { WriteLLMDatabase } from './database.js';
import { emitGenerationEvent } from './generationEvents.js';
import { createPatchFromGenerationRound } from './generationPatch.js';
import { generateLlmObject } from './llmRunner.js';
import { llmPatchProposalSchema } from './harness/patchProtocol.js';
import { readLlmSettings } from './llmSettings.js';

type GenerationJobData = {
  roundId: string;
  prompt: string;
  systemPrompt?: string;
  outputMode?: 'patchProposal';
};

export async function processLlmGenerationJob(
  db: WriteLLMDatabase,
  jobId: string,
  rawData: string
): Promise<void> {
  const data = parseGenerationJobData(rawData);
  const round = db.getGenerationRound(data.roundId);
  if (!round) {
    throw new Error(`Generation round not found: ${data.roundId}`);
  }
  if (round.status === 'canceled') {
    return;
  }

  db.updateGenerationRound(round.id, {
    status: 'processing',
    jobId: Number(jobId),
    errorMessage: null,
    startedAt: new Date().toISOString()
  });
  emitGenerationEvent({ type: 'round_status', roundId: round.id, status: 'processing' });
  const settings = readLlmSettings();

  try {
    const proposal = await generateLlmObject(settings.chat, {
      prompt: data.prompt,
      systemPrompt: data.systemPrompt,
      schema: llmPatchProposalSchema
    });
    if (db.getGenerationRound(round.id)?.status === 'canceled') {
      db.updateGenerationRound(round.id, { status: 'canceled', completedAt: new Date().toISOString() });
      emitGenerationEvent({ type: 'round_status', roundId: round.id, status: 'canceled' });
      return;
    }
    db.updateGenerationRound(round.id, {
      status: 'done',
      content: JSON.stringify(proposal, null, 2),
      modelProvider: settings.chat.provider,
      modelName: settings.chat.model,
      errorMessage: null,
      completedAt: new Date().toISOString()
    });
    emitGenerationEvent({ type: 'round_done', roundId: round.id, status: 'done' });
    try {
      const patch = createPatchFromGenerationRound(db, round.id);
      emitGenerationEvent({ type: 'patch_created', roundId: round.id, patchId: patch.id, status: 'patch_created' });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      db.updateGenerationRound(round.id, { status: 'done', errorMessage: message });
      emitGenerationEvent({ type: 'round_error', roundId: round.id, errorMessage: message });
    }
  } catch (caught) {
    const latest = db.getGenerationRound(round.id);
    const message = caught instanceof Error ? caught.message : String(caught);
    if (latest?.status === 'canceled') {
      db.updateGenerationRound(round.id, { status: 'canceled', completedAt: new Date().toISOString() });
      emitGenerationEvent({ type: 'round_status', roundId: round.id, status: 'canceled' });
      return;
    }
    db.updateGenerationRound(round.id, {
      status: 'error',
      errorMessage: message,
      completedAt: new Date().toISOString()
    });
    emitGenerationEvent({ type: 'round_error', roundId: round.id, errorMessage: message });
    throw new Error(message);
  }
}

function parseGenerationJobData(rawData: string): GenerationJobData {
  const parsed = JSON.parse(rawData) as Partial<GenerationJobData>;
  if (!parsed || typeof parsed.roundId !== 'string' || typeof parsed.prompt !== 'string') {
    throw new Error('Invalid assistant suggestion job data.');
  }
  return {
    roundId: parsed.roundId,
    prompt: parsed.prompt,
    systemPrompt: typeof parsed.systemPrompt === 'string' ? parsed.systemPrompt : undefined,
    outputMode: 'patchProposal'
  };
}
