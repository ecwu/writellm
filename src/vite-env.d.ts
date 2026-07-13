/// <reference types="vite/client" />

import type { AppearanceIpc } from './shared/appearance';
import type { ChapterApi } from './shared/chapters';
import type { WriteLLMIpc } from './shared/ipc';
import type { ProviderSettingsIpc } from './shared/provider-settings';
import type { SourceServicesApi, SourcesApi } from './shared/sources';
import type { WritingOrientationApi } from './shared/writing-orientation';

declare global {
  interface Window {
    writellm: WriteLLMIpc;
    writellmAppearance: AppearanceIpc;
    writellmWritingOrientation: WritingOrientationApi;
    writellmChapters: ChapterApi;
    writellmProviderSettings: ProviderSettingsIpc;
    writellmSources: SourcesApi;
    writellmSourceServices: SourceServicesApi;
  }
}
