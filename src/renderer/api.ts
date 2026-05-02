import type { PaperLabIpc } from '../shared/ipc';

export type PaperLabApi = PaperLabIpc;

export function getApi(): PaperLabApi {
  if (!window.paperlab) {
    throw new Error('PaperLab API is only available inside Electron.');
  }
  return window.paperlab;
}
