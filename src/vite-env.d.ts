/// <reference types="vite/client" />

import type { WriteLLMIpc } from './shared/ipc';

declare global {
  interface Window {
    writellm: WriteLLMIpc;
  }
}

export {};
