/// <reference types="vite/client" />

import type { PaperLabApi } from './renderer/api';

declare global {
  interface Window {
    paperlab?: PaperLabApi;
  }
}
