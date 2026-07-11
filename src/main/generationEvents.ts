import { ipcChannels } from '../shared/ipc.js';
import type { GenerationEvent } from '../shared/types.js';
import { sendToTrustedRenderer } from './security.js';

export function emitGenerationEvent(event: GenerationEvent): void {
  sendToTrustedRenderer(ipcChannels.generationEvent, event);
}
