import type { WriteLLMIpc } from '../shared/ipc';

export type WriteLLMApi = WriteLLMIpc;

export function getApi(): WriteLLMApi {
  if (!window.writellm) {
    throw new Error('writellm API is only available inside Electron.');
  }
  return window.writellm;
}
