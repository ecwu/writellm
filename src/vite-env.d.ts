/// <reference types="vite/client" />

import type { WriteLLMIpc } from './shared/ipc';
import type { AppearanceIpc } from './shared/appearance';
import type { WritingOrientationApi } from './shared/writing-orientation';

declare global {
  interface Window {
    writellm: WriteLLMIpc;
    writellmAppearance: AppearanceIpc;
    writellmWritingOrientation: WritingOrientationApi;
  }
}

export {};
