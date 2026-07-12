/// <reference types="vite/client" />

import type { WriteLLMIpc } from './shared/ipc';
import type { AppearanceIpc } from './shared/appearance';

declare global {
  interface Window {
    writellm: WriteLLMIpc;
    writellmAppearance: AppearanceIpc;
  }
}

export {};
