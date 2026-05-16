import type { GenerateLlmPayload } from '../shared/types.js';
import type { WriteLLMDatabase } from './database.js';
import { streamLlmText } from './llmRunner.js';
import { readLlmSettings } from './llmSettings.js';

type GenerationJobData = {
  roundId: string;
  prompt: string;
  systemPrompt?: string;
};

const FLUSH_INTERVAL_MS = 500;
const FLUSH_CHARS = 200;

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

  db.updateGenerationRound(round.id, { status: 'processing', jobId: Number(jobId), errorMessage: null });
  const settings = readLlmSettings();
  const generationPayload: GenerateLlmPayload = {
    runId: round.id,
    sectionId: '',
    prompt: data.prompt,
    systemPrompt: data.systemPrompt
  };

  let content = round.content ?? '';
  let lastFlushAt = 0;
  let unflushedChars = 0;

  try {
    for await (const chunk of streamLlmText(settings.chat, generationPayload)) {
      content += chunk;
      unflushedChars += chunk.length;
      const now = Date.now();
      if (now - lastFlushAt >= FLUSH_INTERVAL_MS || unflushedChars >= FLUSH_CHARS) {
        if (db.getGenerationRound(round.id)?.status === 'canceled') {
          db.updateGenerationRound(round.id, { status: 'canceled', content });
          return;
        }
        db.updateGenerationRound(round.id, { content });
        lastFlushAt = now;
        unflushedChars = 0;
      }
    }

    if (db.getGenerationRound(round.id)?.status === 'canceled') {
      db.updateGenerationRound(round.id, { status: 'canceled', content });
      return;
    }
    db.updateGenerationRound(round.id, {
      status: 'done',
      content,
      modelProvider: settings.chat.provider,
      modelName: settings.chat.model,
      errorMessage: null
    });
  } catch (caught) {
    const latest = db.getGenerationRound(round.id);
    const message = caught instanceof Error ? caught.message : String(caught);
    if (latest?.status === 'canceled') {
      db.updateGenerationRound(round.id, { status: 'canceled', content });
      return;
    }
    db.updateGenerationRound(round.id, {
      status: 'error',
      content,
      errorMessage: message
    });
    throw new Error(message);
  }
}

function parseGenerationJobData(rawData: string): GenerationJobData {
  const parsed = JSON.parse(rawData) as Partial<GenerationJobData>;
  if (!parsed || typeof parsed.roundId !== 'string' || typeof parsed.prompt !== 'string') {
    throw new Error('Invalid LLM generation job data.');
  }
  return {
    roundId: parsed.roundId,
    prompt: parsed.prompt,
    systemPrompt: typeof parsed.systemPrompt === 'string' ? parsed.systemPrompt : undefined
  };
}
