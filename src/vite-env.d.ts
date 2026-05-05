/// <reference types="vite/client" />

import type { WriteLLMApi } from './renderer/api';

declare global {
  interface Window {
    writellm?: WriteLLMApi;
  }
}
