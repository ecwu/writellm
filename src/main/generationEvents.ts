import { BrowserWindow } from 'electron';
import { ipcChannels } from '../shared/ipc.js';
import type { GenerationEvent } from '../shared/types.js';

export function emitGenerationEvent(event: GenerationEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(ipcChannels.generationEvent, event);
  }
}
